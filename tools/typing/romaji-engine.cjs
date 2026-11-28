"use strict";

// kotobabin-gemini の src/typing/romajiEngine.ts を JavaScript に移植。
// 入力の判定とガイドの選び方は移植元と共通。ライセンスは同梱の COPYING を参照。
const ROMAJI_RULES = typeof module === "undefined"
  ? JSON.parse(document.getElementById("typing-rules").textContent)
  : require("./romaji-rules-v1.json");

const BASIC_TABLE = ROMAJI_RULES.tables.basic;
const YOON_TABLE = ROMAJI_RULES.tables.yoon;
const FOREIGN_TABLE = ROMAJI_RULES.tables.foreign;
const NASAL_KANA = ROMAJI_RULES.nasal.kana;
const NASAL_ALWAYS = ROMAJI_RULES.nasal.always;
const NASAL_CONTEXT_PREFIX = ROMAJI_RULES.nasal.contextPrefix;
const NASAL_BLOCKED = new Set(ROMAJI_RULES.nasal.blockedNextInitials);
const SOKUON_KANA = ROMAJI_RULES.sokuon.kana;
const SOKUON_BLOCKED = new Set(ROMAJI_RULES.sokuon.blockedNextInitials);
const SOKUON_T_PREFIX_BEFORE = ROMAJI_RULES.sokuon.tPrefixBefore;
const SOKUON_T_PREFIX = ROMAJI_RULES.sokuon.tPrefix;
function makeNodeKey(pos, constraint) {
  return `${pos}:${constraint}`;
}
function isEdgeAllowed(romaji, constraint) {
  if (constraint === 'none') {
    return true;
  }
  if (constraint === 'not_vowel_y') {
    return !NASAL_BLOCKED.has(romaji[0]);
  }
  if (constraint === 'must_t_prefix') {
    return SOKUON_T_PREFIX_BEFORE.some((prefix) => romaji.startsWith(prefix));
  }
  if (constraint.startsWith('must_char:')) {
    const required = constraint.slice('must_char:'.length);
    return romaji[0] === required;
  }
  return false;
}
function getRawTransitions(reading, pos) {
  const n = reading.length;
  if (pos >= n) {
    return [];
  }
  const transitions = [];
  const ch = reading[pos];
  // 1. Two-character yoon & foreign shortcuts (checked alongside 1-char rules)
  if (pos + 1 < n) {
    const pair = reading.slice(pos, pos + 2);
    const yoonList = YOON_TABLE[pair];
    if (yoonList) {
      for (const r of yoonList) {
        transitions.push({ toPos: pos + 2, toConstraint: 'none', romaji: r });
      }
    }
    const foreignList = FOREIGN_TABLE[pair];
    if (foreignList) {
      for (const r of foreignList) {
        transitions.push({ toPos: pos + 2, toConstraint: 'none', romaji: r });
      }
    }
  }
  // 2. Nasal 'ん'
  if (ch === NASAL_KANA) {
    for (const r of NASAL_ALWAYS) {
      transitions.push({ toPos: pos + 1, toConstraint: 'none', romaji: r });
    }
    // Single 'n' is only valid when followed by another kana (never terminal)
    if (pos + 1 < n) {
      transitions.push({
        toPos: pos + 1,
        toConstraint: 'not_vowel_y',
        romaji: NASAL_CONTEXT_PREFIX,
      });
    }
    return transitions;
  }
  // 3. Sokuon 'っ'
  if (ch === SOKUON_KANA) {
    const explicitList = BASIC_TABLE[SOKUON_KANA] ?? [];
    for (const r of explicitList) {
      transitions.push({ toPos: pos + 1, toConstraint: 'none', romaji: r });
    }
    if (pos + 1 < n) {
      // Collect possible gemination initials from raw transitions at pos + 1
      const nextRaw = getRawTransitions(reading, pos + 1);
      const seenGeminate = new Set();
      let needsTPrefix = false;
      for (const next of nextRaw) {
        const initial = next.romaji[0];
        if (!SOKUON_BLOCKED.has(initial) && !seenGeminate.has(initial)) {
          seenGeminate.add(initial);
          transitions.push({
            toPos: pos + 1,
            toConstraint: `must_char:${initial}`,
            romaji: initial,
          });
        }
        if (SOKUON_T_PREFIX_BEFORE.some((p) => next.romaji.startsWith(p))) {
          needsTPrefix = true;
        }
      }
      if (needsTPrefix) {
        transitions.push({
          toPos: pos + 1,
          toConstraint: 'must_t_prefix',
          romaji: SOKUON_T_PREFIX,
        });
      }
    }
    return transitions;
  }
  // 4. Basic 1-char kana (including 'ー' -> '-')
  const basicList = BASIC_TABLE[ch];
  if (basicList) {
    for (const r of basicList) {
      transitions.push({ toPos: pos + 1, toConstraint: 'none', romaji: r });
    }
  }
  return transitions;
}
class RomajiEngine {
  reading;
  canonicalLength;
  endNodeKey;
  adjacency = new Map();
  dist = new Map();
  bestEdge = new Map();
  states;
  typed = '';
  completed = false;
  constructor(reading) {
    this.reading = reading;
    const n = reading.length;
    this.endNodeKey = makeNodeKey(n, 'none');
    // Build reachable DAG from (0, 'none')
    const rawByPos = [];
    for (let pos = 0; pos < n; pos++) {
      rawByPos.push(getRawTransitions(reading, pos));
    }
    const startKey = makeNodeKey(0, 'none');
    const visited = new Set([startKey]);
    const queue = [
      { pos: 0, constraint: 'none', key: startKey },
    ];
    const nodesByPos = Array.from({ length: n + 1 }, () => []);
    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      nodesByPos[curr.pos].push({ key: curr.key, pos: curr.pos });
      if (curr.pos >= n) {
        continue;
      }
      const edges = [];
      for (const raw of rawByPos[curr.pos]) {
        if (!isEdgeAllowed(raw.romaji, curr.constraint)) {
          continue;
        }
        const toKey = makeNodeKey(raw.toPos, raw.toConstraint);
        edges.push({ from: curr.key, to: toKey, romaji: raw.romaji });
        if (!visited.has(toKey)) {
          visited.add(toKey);
          queue.push({
            pos: raw.toPos,
            constraint: raw.toConstraint,
            key: toKey,
          });
        }
      }
      this.adjacency.set(curr.key, edges);
    }
    // Compute shortest path distances backwards from pos = n down to 0
    this.dist.set(this.endNodeKey, 0);
    for (let pos = n - 1; pos >= 0; pos--) {
      for (const node of nodesByPos[pos]) {
        const edges = this.adjacency.get(node.key) ?? [];
        let minCost = Infinity;
        let chosen;
        for (const edge of edges) {
          const toCost = this.dist.get(edge.to) ?? Infinity;
          if (toCost === Infinity) {
            continue;
          }
          const cost = edge.romaji.length + toCost;
          if (cost < minCost) {
            minCost = cost;
            chosen = edge;
          }
        }
        this.dist.set(node.key, minCost);
        if (chosen) {
          this.bestEdge.set(node.key, chosen);
        }
      }
    }
    const startDist = this.dist.get(startKey) ?? Infinity;
    if (!Number.isFinite(startDist)) {
      throw new Error(`No valid romaji path for reading: "${reading}"`);
    }
    this.canonicalLength = startDist;
    this.states = [{ kind: 'node', nodeKey: startKey }];
    if (n === 0) {
      this.completed = true;
    }
  }
  get isCompleted() {
    return this.completed;
  }
  get typedText() {
    return this.typed;
  }
  get guide() {
    if (this.completed) {
      return '';
    }
    return this.computeGuide();
  }
  reset() {
    this.states = [{ kind: 'node', nodeKey: makeNodeKey(0, 'none') }];
    this.typed = '';
    this.completed = this.reading.length === 0;
  }
  step(key) {
    if (this.completed) {
      return {
        accepted: false,
        completed: true,
        guide: '',
        typed: this.typed,
      };
    }
    const ch = key.toLowerCase();
    if (ch.length !== 1) {
      return {
        accepted: false,
        completed: false,
        guide: this.computeGuide(),
        typed: this.typed,
      };
    }
    const nextStates = [];
    const seenKeys = new Set();
    const pushState = (state) => {
      const dedupKey = state.kind === 'node'
        ? `N:${state.nodeKey}`
        : `E:${state.edge.from}->${state.edge.to}:${state.edge.romaji}:${state.offset}`;
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        nextStates.push(state);
      }
    };
    for (const state of this.states) {
      if (state.kind === 'node') {
        const edges = this.adjacency.get(state.nodeKey) ?? [];
        for (const edge of edges) {
          const toCost = this.dist.get(edge.to) ?? Infinity;
          if (!Number.isFinite(toCost)) {
            continue;
          }
          if (edge.romaji[0] === ch) {
            if (edge.romaji.length === 1) {
              pushState({ kind: 'node', nodeKey: edge.to });
            }
            else {
              pushState({ kind: 'edge', edge, offset: 1 });
            }
          }
        }
      }
      else {
        const { edge, offset } = state;
        if (edge.romaji[offset] === ch) {
          if (offset + 1 === edge.romaji.length) {
            pushState({ kind: 'node', nodeKey: edge.to });
          }
          else {
            pushState({ kind: 'edge', edge, offset: offset + 1 });
          }
        }
      }
    }
    if (nextStates.length === 0) {
      return {
        accepted: false,
        completed: false,
        guide: this.computeGuide(),
        typed: this.typed,
      };
    }
    this.states = nextStates;
    this.typed += ch;
    const reachedEnd = nextStates.some((s) => s.kind === 'node' && s.nodeKey === this.endNodeKey);
    if (reachedEnd) {
      this.completed = true;
      return {
        accepted: true,
        completed: true,
        guide: '',
        typed: this.typed,
      };
    }
    return {
      accepted: true,
      completed: false,
      guide: this.computeGuide(),
      typed: this.typed,
    };
  }
  computeGuide() {
    let bestLen = Infinity;
    let bestSuffix = '';
    for (const state of this.states) {
      if (state.kind === 'node') {
        const len = this.dist.get(state.nodeKey) ?? Infinity;
        if (len < bestLen) {
          bestLen = len;
          bestSuffix = this.reconstructFromNode(state.nodeKey);
        }
      }
      else {
        const tailLen = this.dist.get(state.edge.to) ?? Infinity;
        const len = state.edge.romaji.length - state.offset + tailLen;
        if (len < bestLen) {
          bestLen = len;
          bestSuffix =
            state.edge.romaji.slice(state.offset) +
              this.reconstructFromNode(state.edge.to);
        }
      }
    }
    return bestSuffix;
  }
  reconstructFromNode(nodeKey) {
    let curr = nodeKey;
    let suffix = '';
    while (curr !== this.endNodeKey) {
      const edge = this.bestEdge.get(curr);
      if (!edge) {
        break;
      }
      suffix += edge.romaji;
      curr = edge.to;
    }
    return suffix;
  }
}

if (typeof module !== "undefined") module.exports = {RomajiEngine};
