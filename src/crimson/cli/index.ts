// Port of crimson/cli/__init__.py

import { tqdm } from 'tqdm';
import * as dbg from '@crimson/cli/dbg.ts';
import * as net from '@crimson/cli/net.ts';
import * as relay from '@crimson/cli/relay.ts';
import * as replay from '@crimson/cli/replay.ts';
import * as root from '@crimson/cli/root.ts';

export const app = root.app;
export const replayApp = replay.replayApp;
export const dbgApp = dbg.dbgApp;
export const netApp = net.netApp;
export const relayApp = relay.relayApp;

app.addTyper(replayApp, { name: 'replay' });
app.addTyper(dbgApp, { name: 'dbg' });
app.addTyper(netApp, { name: 'net' });
app.addTyper(relayApp, { name: 'relay' });

function replayRenderProgressCallback(opts: { totalTicks: number; renderAudio: boolean }): any {
  const totalTicks = opts.totalTicks;
  const renderAudio = opts.renderAudio;
  return replay.replayRenderProgressCallback({ totalTicks: totalTicks, renderAudio: renderAudio, tqdmFactory: tqdm });
}

export function main(argv: string[] | null = null): void {
  app({ progName: 'crimson', args: argv });
}
