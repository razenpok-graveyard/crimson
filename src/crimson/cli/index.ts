// Port of crimson/cli/__init__.py

import { tqdm } from 'tqdm';
import * as _dbg from '@crimson/cli/dbg.ts';
import * as _net from '@crimson/cli/net.ts';
import * as _relay from '@crimson/cli/relay.ts';
import * as _replay from '@crimson/cli/replay.ts';
import * as _root from '@crimson/cli/root.ts';

export const app = _root.app;
export const replayApp = _replay.replayApp;
export const dbgApp = _dbg.dbgApp;
export const netApp = _net.netApp;
export const relayApp = _relay.relayApp;

app.addTyper(replayApp, { name: 'replay' });
app.addTyper(dbgApp, { name: 'dbg' });
app.addTyper(netApp, { name: 'net' });
app.addTyper(relayApp, { name: 'relay' });

function replayRenderProgressCallback(opts: { totalTicks: number; renderAudio: boolean }): any {
  const totalTicks = opts.totalTicks;
  const renderAudio = opts.renderAudio;
  return _replay.replayRenderProgressCallback({ totalTicks: totalTicks, renderAudio: renderAudio, tqdmFactory: tqdm });
}

export function main(argv: string[] | null = null): void {
  app({ progName: 'crimson', args: argv });
}
