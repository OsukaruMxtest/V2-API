(function() {
  'use strict';

  var root = typeof window !== 'undefined' ? window : this;
  if (root.ResultSorting) return;

  function toNum(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function toRank(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? Infinity : n;
  }

  function copy(arr) {
    return Array.isArray(arr) ? arr.slice() : [];
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i++) {
      var val = arguments[i];
      if (val !== undefined && val !== null && val !== '') {
        return val;
      }
    }
    return undefined;
  }

  function sortTeamsGeneral(teams) {
    return copy(teams).sort(function(a, b) {
      a = a || {};
      b = b || {};

      var ap = toNum(a.totalPoints);
      var bp = toNum(b.totalPoints);
      if (ap !== bp) return bp - ap;

      var aw = toNum(a.wwcd);
      var bw = toNum(b.wwcd);
      if (aw !== bw) return bw - aw;

      var app = toNum(a.pp);
      var bpp = toNum(b.pp);
      if (app !== bpp) return bpp - app;

      var ape = toNum(a.pe);
      var bpe = toNum(b.pe);
      if (ape !== bpe) return bpe - ape;

      var ar = toRank(firstDefined(a.lastRank, a.lastPosition, a.rank));
      var br = toRank(firstDefined(b.lastRank, b.lastPosition, b.rank));
      return ar - br;
    });
  }

  function sortPlayersMVP(players) {
    return copy(players).sort(function(a, b) {
      a = a || {};
      b = b || {};

      var ak = toNum(firstDefined(a.kills, a.killNum));
      var bk = toNum(firstDefined(b.kills, b.killNum));
      if (ak !== bk) return bk - ak;

      var ad = toNum(a.damage);
      var bd = toNum(b.damage);
      if (ad !== bd) return bd - ad;

      var ar = toRank(firstDefined(a.rank, a.lastRank, a.teamRank));
      var br = toRank(firstDefined(b.rank, b.lastRank, b.teamRank));
      return ar - br;
    });
  }

  function sortPlayersMVT(players) {
    return copy(players).sort(function(a, b) {
      a = a || {};
      b = b || {};

      var ak = toNum(firstDefined(a.kills, a.killNum));
      var bk = toNum(firstDefined(b.kills, b.killNum));
      if (ak !== bk) return bk - ak;

      var ad = toNum(a.damage);
      var bd = toNum(b.damage);
      if (ad !== bd) return bd - ad;

      var ar = toRank(firstDefined(a.rank, a.lastRank, a.teamRank));
      var br = toRank(firstDefined(b.rank, b.lastRank, b.teamRank));
      return ar - br;
    });
  }

  function sortTeamsMVT(teams) {
    return copy(teams).sort(function(a, b) {
      a = a || {};
      b = b || {};

      var ak = toNum(firstDefined(a.totalKills, a.kills, a.killNum));
      var bk = toNum(firstDefined(b.totalKills, b.kills, b.killNum));
      if (ak !== bk) return bk - ak;

      var ad = toNum(a.totalDamage);
      var bd = toNum(b.totalDamage);
      if (ad !== bd) return bd - ad;

      var ar = toRank(firstDefined(a.bestRank, a.rank, a.lastRank, a.lastPosition));
      var br = toRank(firstDefined(b.bestRank, b.rank, b.lastRank, b.lastPosition));
      return ar - br;
    });
  }

  root.ResultSorting = {
    sortTeamsGeneral: sortTeamsGeneral,
    sortPlayersMVP: sortPlayersMVP,
    sortPlayersMVT: sortPlayersMVT,
    sortTeamsMVT: sortTeamsMVT
  };
})();