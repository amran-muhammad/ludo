import {
  type Color, COLORS,
  type GameState,
  getValidMoves, applyMove, rollDice, botChooseMove, createInitialState,
} from '../lib/ludo';

type WsConn = { color: Color; name: string };

export class GameRoom {
  private state: GameState | null = null;

  constructor(private ctx: DurableObjectState, _env: unknown) {}

  // ── Fetch (WebSocket upgrade) ────────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const gameId = new URL(request.url).pathname.split('/').pop()!;
    await this.ensureState(gameId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as WebSocket[];
    // Hibernatable API: DO sleeps between messages; conn data lives on the socket
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Alarm: bot turns ─────────────────────────────────────────────────────
  async alarm(): Promise<void> {
    await this.ensureState('');
    if (!this.state || this.state.phase !== 'playing') return;

    const color = this.state.currentTurn;
    if (this.state.players[color].type !== 'bot') return;

    if (!this.state.diceRolled) {
      const dice = rollDice();
      this.state.dice = dice;
      this.state.diceRolled = true;
      this.state.movablePieces = getValidMoves(this.state, color, dice);
      this.broadcast({ type: 'diceRolled', color, dice, movablePieces: this.state.movablePieces });

      if (!this.state.movablePieces.length) {
        await this.advanceTurn();
      } else {
        await this.save();
        await this.ctx.storage.setAlarm(Date.now() + 700);
      }
    } else {
      const idx = botChooseMove(this.state, color);
      if (idx === -1) {
        await this.advanceTurn();
        return;
      }
      const { state: ns, extraTurn } = applyMove(this.state, color, idx, this.state.dice!);
      this.state = ns;
      await this.save();
      this.broadcast({ type: 'gameState', state: this.state });

      if (this.state.phase === 'finished') {
        this.broadcast({ type: 'gameOver', winner: this.state.winner, state: this.state });
        return;
      }
      // Schedule next alarm (extra turn = shorter delay)
      await this.ctx.storage.setAlarm(Date.now() + (extraTurn ? 500 : 1000));
    }
  }

  // ── Hibernatable WebSocket handlers ──────────────────────────────────────
  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer): Promise<void> {
    await this.ensureState('');
    try {
      const msg = JSON.parse(typeof rawMsg === 'string' ? rawMsg : new TextDecoder().decode(rawMsg));
      await this.dispatch(ws, msg);
    } catch { /* ignore malformed */ }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ensureState('');
    const conn = ws.deserializeAttachment() as WsConn | null;
    if (conn && this.state) {
      this.state.players[conn.color].connected = false;
      this.state.connectedCount = Math.max(0, this.state.connectedCount - 1);
      this.state.players[conn.color].type = 'bot';
      await this.save();
      this.broadcast({ type: 'playerLeft', color: conn.color, state: this.state }, ws);

      // If it's now a bot's turn, schedule the alarm
      if (this.state.phase === 'playing' &&
          this.state.players[this.state.currentTurn].type === 'bot') {
        await this.ctx.storage.setAlarm(Date.now() + 1500);
      }
    }
  }

  async webSocketError(ws: WebSocket, _err: unknown): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── Message dispatch ─────────────────────────────────────────────────────
  private async dispatch(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'join':   return this.onJoin(ws, msg);
      case 'rollDice': return this.onRoll(ws);
      case 'move':   return this.onMove(ws, msg);
    }
  }

  private async onJoin(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    if (!this.state) return;

    const color = COLORS.find(c => !this.state!.players[c].connected);
    if (!color) {
      ws.send(JSON.stringify({ type: 'error', message: 'Game is full (4/4 players)' }));
      return;
    }

    const name = String(msg.name ?? `Player ${color}`).slice(0, 24);
    this.state.players[color].type = 'human';
    this.state.players[color].name = name;
    this.state.players[color].connected = true;
    this.state.connectedCount++;

    if (this.state.phase === 'waiting') this.state.phase = 'playing';

    // Store connection metadata on the WebSocket (survives hibernation)
    ws.serializeAttachment({ color, name } satisfies WsConn);

    await this.save();
    ws.send(JSON.stringify({ type: 'joined', color, state: this.state }));
    this.broadcast({ type: 'playerJoined', color, name, state: this.state }, ws);

    // Kick off bot turn if needed
    if (this.state.players[this.state.currentTurn].type === 'bot') {
      await this.ctx.storage.setAlarm(Date.now() + 1200);
    }
  }

  private async onRoll(ws: WebSocket): Promise<void> {
    if (!this.state) return;
    const conn = ws.deserializeAttachment() as WsConn | null;
    if (!conn) return;
    if (this.state.phase !== 'playing') return;
    if (this.state.currentTurn !== conn.color || this.state.diceRolled) return;

    const dice = rollDice();
    this.state.dice = dice;
    this.state.diceRolled = true;
    this.state.movablePieces = getValidMoves(this.state, conn.color, dice);
    await this.save();

    this.broadcast({ type: 'diceRolled', color: conn.color, dice, movablePieces: this.state.movablePieces });

    if (!this.state.movablePieces.length) await this.advanceTurn();
  }

  private async onMove(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    if (!this.state) return;
    const conn = ws.deserializeAttachment() as WsConn | null;
    if (!conn) return;
    if (this.state.phase !== 'playing') return;
    if (this.state.currentTurn !== conn.color || !this.state.diceRolled) return;

    const tokenIdx = Number(msg.tokenIndex);
    if (!this.state.movablePieces.includes(tokenIdx)) return;

    const { state: ns, extraTurn } = applyMove(this.state, conn.color, tokenIdx, this.state.dice!);
    this.state = ns;
    await this.save();
    this.broadcast({ type: 'gameState', state: this.state });

    if (this.state.phase === 'finished') {
      this.broadcast({ type: 'gameOver', winner: this.state.winner, state: this.state });
      return;
    }

    if (this.state.players[this.state.currentTurn].type === 'bot') {
      await this.ctx.storage.setAlarm(Date.now() + (extraTurn ? 600 : 1000));
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private async advanceTurn(): Promise<void> {
    if (!this.state) return;
    const idx = this.state.playerOrder.indexOf(this.state.currentTurn);
    this.state.currentTurn = this.state.playerOrder[(idx + 1) % this.state.playerOrder.length];
    this.state.dice = null;
    this.state.diceRolled = false;
    this.state.movablePieces = [];
    await this.save();
    this.broadcast({ type: 'gameState', state: this.state });

    if (this.state.players[this.state.currentTurn].type === 'bot') {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  private broadcast(msg: unknown, exclude?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try { ws.send(data); } catch { /* closed */ }
    }
  }

  private async save(): Promise<void> {
    if (this.state) await this.ctx.storage.put('state', this.state);
  }

  private async ensureState(gameId: string): Promise<void> {
    if (!this.state) {
      this.state = (await this.ctx.storage.get<GameState>('state')) ?? null;
    }
    if (!this.state && gameId) {
      this.state = createInitialState(gameId);
      await this.save();
    }
  }
}
