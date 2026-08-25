/* worker.js — GA를 별 스레드에서 (UI 안 멈추게). 본체는 ga.js 공용. */
importScripts('geom.js', 'design.js', 'alignment.js', 'terrain.js', 'profile.js', 'score.js', 'ga.js');

let CTX = null, stopFlag = false;

function buildCtx(site, params, terrain, pparams, useGenomeProfile) {
  const obs = params.useExtraObstacle ? site.obstacle.concat(site.obstacle_extra) : site.obstacle;
  if (terrain) KHTerrain.load(terrain);
  return {
    site: site, params: params, pparams: pparams || null,
    useGenomeProfile: !!useGenomeProfile,
    obsGrid: new KHGeom.Grid(obs, 120),
    roadGrid: new KHGeom.Grid(site.road, 120)
  };
}

onmessage = function (e) {
  const msg = e.data;
  if (msg.type === 'init') {
    CTX = buildCtx(msg.site, msg.params, msg.terrain, msg.pparams, msg.useGenomeProfile);
    postMessage({ type: 'ready', obstacles: CTX.obsGrid.polys.length, roads: CTX.roadGrid.polys.length });
  } else if (msg.type === 'run') {
    stopFlag = false;
    const res = KHGA.run(msg.cfg, CTX, (p) => postMessage(p), () => stopFlag);
    postMessage(res);
  } else if (msg.type === 'stop') {
    stopFlag = true;
  }
};
