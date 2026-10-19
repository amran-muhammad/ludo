/// <reference types="astro/client" />

type Env = {
  GAME_ROOM: DurableObjectNamespace;
};

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}
