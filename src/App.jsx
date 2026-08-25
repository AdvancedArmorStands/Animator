import React, {
  useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle,
} from 'react';
import * as THREE from 'three';
import {
  Play, Pause, Plus, Trash2, Copy, Download, ChevronDown, ChevronRight, ChevronLeft,
  Lock, Unlock, Eye, EyeOff, MousePointer2, ZoomIn, ZoomOut, SkipBack, SkipForward,
  StepBack, StepForward, Repeat, Maximize2, Minimize2, Timer, RotateCcw, Settings2, Grid3x3, Check, CornerDownRight, Save, HelpCircle, HardDrive, Sun, Box,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Data model                                                        */
/* ------------------------------------------------------------------ */

const PARTS = ['head', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];
const AXES = ['x', 'y', 'z'];

const PART_META = {
  head: { label: 'Head', badge: 'HD', color: '#ff8a3d' },
  left_arm: { label: 'Left Arm', badge: 'LA', color: '#4fc3f7' },
  right_arm: { label: 'Right Arm', badge: 'RA', color: '#7c8cff' },
  left_leg: { label: 'Left Leg', badge: 'LL', color: '#66d19e' },
  right_leg: { label: 'Right Leg', badge: 'RL', color: '#f472b6' },
};

const ZERO_POSE_PART = { x: 0, y: 0, z: 0 };

function round1(v) {
  return Math.round(v * 10) / 10;
}
function zeroStep() {
  const s = {};
  PARTS.forEach((p) => { s[p] = { x: 0, y: 0, z: 0 }; });
  return s;
}
function cloneSteps(steps) {
  return JSON.parse(JSON.stringify(steps));
}

const DEFAULT_STEPS = [
  {
    head: { x: 0, y: 0, z: 0 },
    left_arm: { x: -30, y: 0, z: -10 },
    right_arm: { x: -30, y: 0, z: 10 },
    left_leg: { x: 10, y: 0, z: 0 },
    right_leg: { x: -10, y: 0, z: 0 },
  },
  {
    head: { x: 0, y: 0, z: 0 },
    left_arm: { x: -10, y: 0, z: 30 },
    right_arm: { x: -10, y: 0, z: -30 },
    left_leg: { x: -10, y: 0, z: 0 },
    right_leg: { x: 10, y: 0, z: 0 },
  },
];

const PANEL_META = {
  pose: { title: 'Pose' },
  settings: { title: 'Settings' },
};
const DEFAULT_LAYOUT = { left: ['pose'], right: ['settings'], bottom: [] };
const DEFAULT_ACTIVE_TAB = { left: 'pose', right: 'settings', bottom: null };

function lerpPose(a, b, t) {
  const out = {};
  PARTS.forEach((part) => {
    out[part] = {
      x: a[part].x + (b[part].x - a[part].x) * t,
      y: a[part].y + (b[part].y - a[part].y) * t,
      z: a[part].z + (b[part].z - a[part].z) * t,
    };
  });
  return out;
}
function applyVisibility(pose, hiddenParts) {
  const out = {};
  PARTS.forEach((part) => { out[part] = hiddenParts[part] ? ZERO_POSE_PART : pose[part]; });
  return out;
}
// Exact pose at a fractional timeline position (e.g. 3.4 = 40% between step 3 and 4).
function getPoseAtPosition(steps, position) {
  const total = steps.length;
  if (total === 0) return null;
  const curIdx = Math.min(total - 1, Math.max(0, Math.floor(position)));
  const nextIdx = Math.min(total - 1, curIdx + 1);
  const t = Math.min(1, Math.max(0, position - curIdx));
  if (t <= 0 || curIdx === nextIdx) return steps[curIdx];
  return lerpPose(steps[curIdx], steps[nextIdx], t);
}
function formatTime(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const msPart = totalMs % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msPart).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Hand-written parser for this plugin's exact animations.yml shape  */
/* ------------------------------------------------------------------ */

function findAnimationBlocks(lines) {
  // Every animation name in the file sits 2 spaces deep (either under an
  // "animations:" root, or as the file's own top-level entries) and is
  // followed shortly by "interval:". Collect all of them, in order.
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^ {0,2}([A-Za-z0-9_-]+):\s*$/);
    if (!m || m[1] === 'animations') continue;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      if (/interval:/.test(lines[j])) { blocks.push({ name: m[1], start: i }); break; }
    }
  }
  blocks.forEach((b, i) => { b.end = i + 1 < blocks.length ? blocks[i + 1].start : lines.length; });
  return blocks;
}
function listAnimationNames(text) {
  const lines = text.split('\n').map((l) => l.replace(/#.*$/, ''));
  return findAnimationBlocks(lines).map((b) => b.name);
}
function parseAnimationYaml(text, pickName) {
  const lines = text.split('\n').map((l) => l.replace(/#.*$/, '').replace(/\r$/, ''));
  const blocks = findAnimationBlocks(lines);
  if (blocks.length === 0) return null;
  const block = pickName ? (blocks.find((b) => b.name === pickName) || blocks[0]) : blocks[0];
  const { name, start, end } = block;
  const blockLines = lines.slice(start, end);
  const blockText = blockLines.join('\n');

  const intervalMatch = blockText.match(/interval:\s*(\d+(?:\.\d+)?)/);
  const loopMatch = blockText.match(/loop:\s*(true|false)/);
  const interval = intervalMatch ? Math.max(1, parseInt(intervalMatch[1], 10)) : 10;
  const loop = loopMatch ? loopMatch[1] === 'true' : true;
  const realMatch = blockText.match(/realistic-animations:\s*\n\s*enabled:\s*(true|false)\s*\n\s*frames:\s*(\d+)/);
  const realisticEnabled = realMatch ? realMatch[1] === 'true' : false;
  const realisticFrames = realMatch ? Math.max(1, parseInt(realMatch[2], 10)) : 1;

  let stepsIdx = -1;
  for (let i = 0; i < blockLines.length; i += 1) {
    if (/^\s*steps:\s*$/.test(blockLines[i])) { stepsIdx = i; break; }
  }
  if (stepsIdx < 0) return null;

  const steps = [];
  let current = null;
  let curPart = null;
  for (let i = stepsIdx + 1; i < blockLines.length; i += 1) {
    const line = blockLines[i];
    if (!line.trim()) continue;
    const dashMatch = line.match(/^\s*-\s*([A-Za-z0-9_]+):\s*$/);
    const partMatch = line.match(/^\s*([A-Za-z0-9_]+):\s*$/);
    const axisMatch = line.match(/^\s*([xyz]):\s*(-?\d+(?:\.\d+)?)/);
    if (dashMatch) {
      current = zeroStep();
      steps.push(current);
      curPart = dashMatch[1];
      continue;
    }
    if (partMatch && PARTS.includes(partMatch[1])) {
      curPart = partMatch[1];
      continue;
    }
    if (axisMatch && current && curPart && PARTS.includes(curPart)) {
      current[curPart][axisMatch[1]] = parseFloat(axisMatch[2]);
      continue;
    }
  }
  if (steps.length === 0) return null;
  return {
    name, interval, loop, realisticEnabled, realisticFrames, steps,
    allNames: blocks.map((b) => b.name),
  };
}

/* ------------------------------------------------------------------ */
/*  Draggable numeric field                                           */
/* ------------------------------------------------------------------ */

function NumberField({ value, onChange, accent, disabled, onDragStart }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(round1(value)));
  const dragRef = useRef(null);

  useEffect(() => {
    if (!editing) setText(String(round1(value)));
  }, [value, editing]);

  const onPointerDown = (e) => {
    if (editing || disabled) return;
    if (onDragStart) onDragStart();
    dragRef.current = { startX: e.clientX, startVal: value, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || disabled) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 2) d.moved = true;
    if (d.moved) {
      const mult = e.shiftKey ? 0.1 : 1;
      onChange(round1(d.startVal + dx * mult));
    }
  };
  const onPointerUp = () => {
    if (dragRef.current && !dragRef.current.moved && !disabled) setEditing(true);
    dragRef.current = null;
  };
  const commit = () => {
    const n = parseFloat(text);
    if (!Number.isNaN(n)) onChange(round1(n));
    setEditing(false);
  };

  return (
    <div
      className={`num-field${disabled ? ' disabled' : ''}`}
      style={{ '--accent': accent }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {editing ? (
        <input
          autoFocus
          className="num-input" spellCheck={false} autoCorrect="off" autoCapitalize="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="num-value">{round1(value)}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3D viewport                                                       */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Paints a 16x16 canvas in the style of vanilla Minecraft block textures
   (per-pixel value jitter, hard plank seams) and returns it as a crisp
   nearest-neighbour THREE texture. */
function makeMcTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d');
  const rng = mulberry32(kind === 'stone' ? 1337 : kind === 'birchDark' ? 42 : 7);

  let r; let g; let b; let jitter;
  if (kind === 'stone') { [r, g, b, jitter] = [127, 127, 127, 16]; } else if (kind === 'birchDark') { [r, g, b, jitter] = [166, 152, 109, 10]; } else { [r, g, b, jitter] = [199, 186, 141, 12]; } // birch planks

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = Math.floor((rng() - 0.5) * 2 * jitter);
      ctx.fillStyle = `rgb(${r + n},${g + n},${b + n})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  if (kind !== 'stone') {
    // horizontal plank seams every 4px + short birch bark dashes
    ctx.fillStyle = 'rgba(96,86,58,0.9)';
    for (const yy of [0, 4, 8, 12]) ctx.fillRect(0, yy, 16, 1);
    ctx.fillStyle = 'rgba(70,62,44,0.85)';
    for (let i = 0; i < 7; i++) {
      const xx = Math.floor(rng() * 14);
      const yy = Math.floor(rng() * 15);
      ctx.fillRect(xx, yy, 2, 1);
    }
  } else {
    // stone speckles
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 10; i++) ctx.fillRect(Math.floor(rng() * 16), Math.floor(rng() * 16), 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 10; i++) ctx.fillRect(Math.floor(rng() * 16), Math.floor(rng() * 16), 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const Viewport = forwardRef(function Viewport({ initialShowGrid, initialShowShadows, initialRealistic, locked }, ref) {
  const lockedRef = useRef(locked);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  const mountRef = useRef(null);
  const stateRef = useRef({});

  useImperativeHandle(ref, () => ({
    setPose(pose) {
      const s = stateRef.current;
      if (!pose) return;
      const apply = (joints) => {
        if (!joints) return;
        PARTS.forEach((part) => {
          const g = joints[part];
          const p = pose[part];
          if (g && p) {
            g.rotation.set(
              THREE.MathUtils.degToRad(p.x),
              THREE.MathUtils.degToRad(p.y),
              THREE.MathUtils.degToRad(p.z),
            );
          }
        });
      };
      apply(s.joints);
      apply(s.jointsClassic);
    },
    setGridVisible(v) {
      const s = stateRef.current;
      if (s.grid) s.grid.visible = v;
    },
    setShadowsEnabled(v) {
      const s = stateRef.current;
      if (!s.renderer || !s.keyLight || !s.ground) return;
      s.renderer.shadowMap.enabled = v;
      s.keyLight.castShadow = v;
      s.ground.visible = v;
      // materials compiled with/without shadow support must be flushed on toggle
      s.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    },
    setRealisticModel(v) {
      const s = stateRef.current;
      if (!s.realGroup || !s.classicGroup || !s.jointsClassic) return;
      s.realGroup.visible = v;
      s.classicGroup.visible = !v;
      // raise the orbit focus a touch so the taller vanilla-style stand fits
      if (s.target && s.updateCamera) {
        s.target.y = v ? 1.0 : 0.75;
        s.updateCamera();
      }
    },
    resetView() {
      const s = stateRef.current;
      if (!s.spherical) return;
      s.spherical.theta = 0.75;
      s.spherical.phi = 1.15;
      s.spherical.radius = 3.3;
      s.updateCamera && s.updateCamera();
    },
  }));

  useEffect(() => {
    const mount = mountRef.current;
    let width = mount.clientWidth || 400;
    let height = mount.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141414);
    scene.fog = new THREE.Fog(0x141414, 6, 14);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = initialShowShadows !== false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0x8899aa, 0x141414, 0.65);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff2e0, 1.15);
    key.position.set(2.4, 4, 2.2);
    key.castShadow = initialShowShadows !== false;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 2;
    key.shadow.camera.bottom = -2;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6f9fff, 0.35);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const grid = new THREE.GridHelper(10, 20, 0x2e2e2e, 0x1e1e1e);
    grid.visible = initialShowGrid;
    scene.add(grid);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 32),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.visible = initialShowShadows !== false;
    scene.add(ground);

    /* --- Two stand models: "classic" (original boxes) and "realistic"
           (pixel-art vanilla-style). Toggled from the settings menu. ------- */
    const PX = 1 / 16;
    const texWood = makeMcTexture('birch');
    const texWoodDark = makeMcTexture('birchDark');
    const texStone = makeMcTexture('stone');
    const matWood = new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.9 });
    const matWoodDark = new THREE.MeshStandardMaterial({ map: texWoodDark, roughness: 0.95 });
    const matStone = new THREE.MeshStandardMaterial({ map: texStone, roughness: 1 });
    const matBody = new THREE.MeshStandardMaterial({ color: 0xd8d6cd, roughness: 0.85, flatShading: true });
    const matDarkC = new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.7, flatShading: true });
    const matWoodC = new THREE.MeshStandardMaterial({ color: 0x8a6a3d, roughness: 0.9, flatShading: true });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 });

    // MC boxes are textured per-face in vanilla; we approximate by tiling the
    // texture so each world unit maps to whole pixels (repeat = size / 16px).
    function mcBox(wPx, hPx, dPx, mat) {
      const geo = new THREE.BoxGeometry(wPx * PX, hPx * PX, dPx * PX);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      return mesh;
    }
    function boxWithEdges(w, h, d, mat) {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      return mesh;
    }

    /* --- Realistic (vanilla-style) model ------------------------------ */
    const realGroup = new THREE.Group();
    scene.add(realGroup);
    realGroup.visible = initialRealistic !== false;
    const joints = {};

    // Vanilla-style armor stand layout in entity pixels (1px = 1/16 block),
    // every part occupies a strict y-range so nothing clips:
    //   base  12x1x12        y=[0,1]
    //   legs  2x12x2 @x=±2   y=[1,13]   (pivot/hip at y=13, body underside)
    //   body  6x12x3         y=[13,25]
    //   bar   10x1x2         y=[25,26]
    //   arms  2x12x2 @x=±4.5 y=[14,26]  (pivot at bar level y=25)
    //   head  2x6x2 stick    y=[26,32]

    const base = mcBox(12, 1, 12, matStone);
    base.position.set(0, 0.5 * PX, 0);
    realGroup.add(base);

    // Legs — plain vertical sticks tucked under the body, hips at body underside
    const LEG_PIVOT_Y = 13;
    [['left_leg', -2], ['right_leg', 2]].forEach(([key, xPx]) => {
      const pivot = new THREE.Group();
      pivot.position.set(xPx * PX, LEG_PIVOT_Y * PX, 0);
      const stick = mcBox(2, 12, 2, matWood); // center 6px below pivot -> y=[1,13]
      stick.position.set(0, -6 * PX, 0);
      pivot.add(stick);
      realGroup.add(pivot);
      joints[key] = pivot;
    });

    // Body: tall stretched board sitting directly on the leg tops
    const BODY_BOTTOM = 13;
    const body = mcBox(6, 12, 3, matWood); // y=[13,25]
    body.position.set(0, (BODY_BOTTOM + 6) * PX, 0);
    realGroup.add(body);

    // Shoulder bar tying the two arm pivots together across the body top
    const SHOULDER_Y = 25;
    const shoulderBar = mcBox(11, 1, 2, matWoodDark); // y=[25,26], x=[-5.5,5.5] — flush with the arms' outer edges
    shoulderBar.position.set(0, (SHOULDER_Y + 0.5) * PX, 0);
    realGroup.add(shoulderBar);

    // Arms — 2x12x2 sticks hanging just off the body sides (~0.5px gap)
    [['left_arm', -4.5], ['right_arm', 4.5]].forEach(([key, xPx]) => {
      const pivot = new THREE.Group();
      pivot.position.set(xPx * PX, SHOULDER_Y * PX, 0);
      const stick = mcBox(2, 12, 2, matWood); // center 6px below pivot -> y=[14,26]
      stick.position.set(0, -6 * PX, 0);
      pivot.add(stick);
      realGroup.add(pivot);
      joints[key] = pivot;
    });

    // Head: vanilla has none — just a small stick peg where a helmet sits
    const headPivot = new THREE.Group();
    headPivot.position.set(0, (SHOULDER_Y + 1) * PX, 0);
    const head = mcBox(2, 6, 2, matWood); // y=[26,32]
    head.position.set(0, 3 * PX, 0);
    headPivot.add(head);
    realGroup.add(headPivot);
    joints.head = headPivot;

    /* --- Classic (original placeholder) model — restored verbatim ------ */
    const classicGroup = new THREE.Group();
    scene.add(classicGroup);
    classicGroup.visible = initialRealistic === false;
    const jointsClassic = {};

    const cBase = boxWithEdges(0.8, 0.07, 0.8, matWoodC);
    cBase.position.set(0, 0.035, 0);
    classicGroup.add(cBase);
    const basePole = boxWithEdges(0.1, 0.1, 0.1, matDarkC);
    basePole.position.set(0, 0.12, 0);
    classicGroup.add(basePole);

    const hipsY = 0.62;
    const hips = boxWithEdges(0.14, 0.06, 0.14, matDarkC);
    hips.position.set(0, hipsY, 0);
    classicGroup.add(hips);

    [['left_leg', -0.11], ['right_leg', 0.11]].forEach(([key, x]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, hipsY, 0);
      const leg = boxWithEdges(0.13, 0.58, 0.13, matBody);
      leg.position.set(0, -0.29, 0);
      pivot.add(leg);
      const foot = boxWithEdges(0.15, 0.08, 0.15, matDarkC);
      foot.position.set(0, -0.58, 0);
      pivot.add(foot);
      classicGroup.add(pivot);
      jointsClassic[key] = pivot;
    });

    const torsoY1 = 1.14;
    const torso = boxWithEdges(0.38, torsoY1 - hipsY, 0.22, matBody);
    torso.position.set(0, (hipsY + torsoY1) / 2, 0);
    classicGroup.add(torso);

    const shoulderY = torsoY1;
    const shoulderBarC = boxWithEdges(0.6, 0.08, 0.1, matDarkC);
    shoulderBarC.position.set(0, shoulderY, 0);
    classicGroup.add(shoulderBarC);

    [['left_arm', -0.33], ['right_arm', 0.33]].forEach(([key, x]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, shoulderY, 0);
      const arm = boxWithEdges(0.12, 0.56, 0.12, matBody);
      arm.position.set(0, -0.28, 0);
      pivot.add(arm);
      const hand = boxWithEdges(0.14, 0.09, 0.14, matDarkC);
      hand.position.set(0, -0.56, 0);
      pivot.add(hand);
      classicGroup.add(pivot);
      jointsClassic[key] = pivot;
    });

    const neck = boxWithEdges(0.08, 0.1, 0.08, matDarkC);
    neck.position.set(0, shoulderY + 0.09, 0);
    classicGroup.add(neck);

    const headPivotC = new THREE.Group();
    headPivotC.position.set(0, shoulderY + 0.14, 0);
    const headC = boxWithEdges(0.42, 0.42, 0.42, matBody);
    headC.position.set(0, 0.22, 0);
    headPivotC.add(headC);
    classicGroup.add(headPivotC);
    jointsClassic.head = headPivotC;

    const spherical = { theta: 0.75, phi: 1.15, radius: 3.3 };
    const target = new THREE.Vector3(0, initialRealistic !== false ? 1.0 : 0.75, 0);

    function updateCamera() {
      spherical.phi = Math.max(0.35, Math.min(Math.PI - 0.35, spherical.phi));
      spherical.radius = Math.max(1.6, Math.min(7, spherical.radius));
      const x = target.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      const y = target.y + spherical.radius * Math.cos(spherical.phi);
      const z = target.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.set(x, y, z);
      camera.lookAt(target);
    }
    updateCamera();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const dom = renderer.domElement;
    const onDown = (e) => {
      if (lockedRef.current) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      spherical.theta -= dx * 0.006;
      spherical.phi -= dy * 0.006;
      updateCamera();
    };
    const onUp = () => {
      dragging = false;
      dom.style.cursor = 'grab';
    };
    const onWheel = (e) => {
      e.preventDefault();
      if (lockedRef.current) return;
      spherical.radius += e.deltaY * 0.0018 * spherical.radius;
      updateCamera();
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointerleave', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    stateRef.current = { scene, camera, renderer, joints, jointsClassic, realGroup, classicGroup, spherical, target, updateCamera, grid, keyLight: key, ground };

    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    const resizeObserver = new ResizeObserver(() => {
      width = mount.clientWidth;
      height = mount.clientHeight;
      if (!width || !height) return;
      // re-read DPR so browser page-zoom keeps the canvas crisp
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(mount);

    // Browser zoom (Ctrl+/-) changes devicePixelRatio WITHOUT resizing the
    // canvas element, so watch it directly or the render goes soft/blurry.
    let lastDpr = window.devicePixelRatio || 1;
    const onDprChange = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (dpr === lastDpr) return;
      lastDpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const dprMedia = window.matchMedia(`(resolution: ${lastDpr}dppx)`);
    const handleDprMedia = () => { onDprChange(); dprMedia.removeEventListener('change', handleDprMedia); };
    dprMedia.addEventListener('change', handleDprMedia);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      dprMedia.removeEventListener('change', handleDprMedia);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointerleave', onUp);
      dom.removeEventListener('wheel', onWheel);
      if (dom.parentNode === mount) mount.removeChild(dom);
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} className="viewport-canvas" />;
});

/* ------------------------------------------------------------------ */
/*  Pose inspector (left panel)                                       */
/* ------------------------------------------------------------------ */

function PartsPanel({
  stepIndex, steps, pose, onChangeAxis, expanded, toggleExpanded, lockedParts, hiddenParts,
  onDragStart, onFlattenAxis, onJumpChange, onResetAxis, onValueContextMenu, partOrder,
}) {
  return (
    <>
      <div className="panel-sub">Step {stepIndex + 1} — drag a value to scrub, click to type</div>
      <div className="parts-list">
        {partOrder.map((part) => {
          const locked = !!lockedParts[part];
          const hidden = !!hiddenParts[part];
          return (
            <div key={part} className={`part-block${hidden ? ' is-hidden' : ''}`}>
              <button type="button" className="part-head" onClick={() => toggleExpanded(part)}>
                {expanded[part] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="badge-chip" style={{ borderColor: PART_META[part].color, color: PART_META[part].color }}>
                  {PART_META[part].badge}
                </span>
                <span className="part-label">{PART_META[part].label}</span>
                {locked && <Lock size={12} className="inline-flag" />}
              </button>
              {expanded[part] && (
                <div className="prop-list">
                  {AXES.map((axis) => {
                    const animated = steps.some((s) => s[part][axis] !== steps[0][part][axis]);
                    const value = pose[part][axis];
                    const hasPrev = steps.slice(0, stepIndex).some((s) => s[part][axis] !== value);
                    const hasNext = steps.slice(stepIndex + 1).some((s) => s[part][axis] !== value);
                    return (
                      <div key={axis} className="prop-row" onContextMenu={(e) => onValueContextMenu(e, part, axis)}>
                        <button
                          type="button"
                          className={`stopwatch-btn${animated ? ' on' : ''}`}
                          style={{ '--accent': PART_META[part].color }}
                          disabled={locked || !animated}
                          onClick={() => onFlattenAxis(part, axis)}
                          title={animated ? `Make ${axis.toUpperCase()} constant across all steps` : `${axis.toUpperCase()} is constant on every step`}
                        >
                          <Timer size={12} />
                        </button>
                        <span className="prop-label">{PART_META[part].label} {axis.toUpperCase()}</span>
                        <div className="prop-spacer" />
                        <NumberField
                          value={value}
                          accent={PART_META[part].color}
                          disabled={locked}
                          onDragStart={onDragStart}
                          onChange={(v) => onChangeAxis(part, axis, v)}
                        />
                        <div className="keyframe-nav">
                          <button
                            type="button"
                            className="kf-nav-btn"
                            disabled={!hasPrev}
                            onClick={() => onJumpChange(part, axis, -1)}
                            title="Previous change"
                          >
                            <ChevronLeft size={13} />
                          </button>
                          <button
                            type="button"
                            className="kf-reset-btn"
                            disabled={locked}
                            onClick={() => onResetAxis(part, axis)}
                            title="Reset this value to 0 on this step"
                          >
                            <RotateCcw size={12} />
                          </button>
                          <button
                            type="button"
                            className="kf-nav-btn"
                            disabled={!hasNext}
                            onClick={() => onJumpChange(part, axis, 1)}
                            title="Next change"
                          >
                            <ChevronRight size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings (right panel) — Animate workspace only                   */
/* ------------------------------------------------------------------ */

function SettingsPanel({
  animName, setAnimName, interval, setInterval: setIntervalVal, loop, setLoop,
  realisticEnabled, setRealisticEnabled, realisticFrames, setRealisticFrames,
  steps, onFieldFocus,
}) {
  const durationSec = (Math.max(steps.length - 1, 0) * interval * 50 / 1000).toFixed(2);

  return (
    <div className="tab-panel">
      <label className="field">
        <span>Name</span>
        <input
          className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off"
          value={animName}
          onFocus={onFieldFocus}
          onChange={(e) => setAnimName(e.target.value.replace(/\s+/g, '_'))}
        />
      </label>
      <label className="field">
        <span>Interval (ticks)</span>
        <input
            className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off"
            type="number"
            min="1"
            value={interval}
            onFocus={onFieldFocus}
            onChange={(e) => setIntervalVal(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
        </label>
        <label className="field checkbox-field">
          <span>Smooth animation</span>
          <button
            type="button"
            className={`tick-box${realisticEnabled ? ' on' : ''}`}
            onClick={() => { onFieldFocus(); setRealisticEnabled((v) => !v); }}
          >
            {realisticEnabled && <Check size={12} />}
          </button>
        </label>
        {realisticEnabled && (
          <label className="field">
            <span>Interpolation frames</span>
            <input
              className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off"
              type="number"
              min="1"
              value={realisticFrames}
              onFocus={onFieldFocus}
              onChange={(e) => setRealisticFrames(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </label>
        )}
        <label className="field checkbox-field">
          <span>Loop</span>
          <button
            type="button"
            className={`tick-box${loop ? ' on' : ''}`}
            onClick={() => { onFieldFocus(); setLoop((l) => !l); }}
          >
            {loop && <Check size={12} />}
          </button>
        </label>
        <div className="stat-row">
          <div><span className="stat-num">{steps.length}</span><span className="stat-label">steps</span></div>
          <div><span className="stat-num">{durationSec}s</span><span className="stat-label">duration</span></div>
        </div>
      </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export workspace — completely replaces the Animate layout         */
/* ------------------------------------------------------------------ */

function ExportWorkspace({
  animName, interval, loop, realisticEnabled, realisticFrames, steps, fullYaml, copySnippet, downloadYaml, copyStatus, downloadStatus,
  onSaveBrowser, saveBrowserStatus,
}) {
  const durationSec = (Math.max(steps.length - 1, 0) * interval * 50 / 1000).toFixed(2);
  return (
    <div className="export-workspace">
      <div className="export-side">
        <div className="export-side-header">Export Summary</div>
        <div className="export-summary">
          <div className="summary-row"><span>Name</span><b>{animName || 'unnamed'}</b></div>
          <div className="summary-row"><span>Interval</span><b>{interval} ticks</b></div>
          <div className="summary-row"><span>Loop</span><b>{loop ? 'Yes' : 'No'}</b></div>
          <div className="summary-row"><span>Smooth animation</span><b>{realisticEnabled ? `On · ${realisticFrames}f` : 'Off'}</b></div>
          <div className="summary-row"><span>Steps</span><b>{steps.length}</b></div>
          <div className="summary-row"><span>Duration</span><b>{durationSec}s</b></div>
        </div>

        <button type="button" className="export-btn" onClick={copySnippet}>
          <Copy size={15} /> Copy animation block
        </button>
        <div className="hint">
          Paste this under the <code>animations:</code> key in your existing <code>animations.yml</code>.
        </div>
        {copyStatus && <div className="status-msg">{copyStatus}</div>}

        <button type="button" className="export-btn primary" onClick={downloadYaml} style={{ marginTop: 14 }}>
          <Download size={15} /> Download animations.yml
        </button>
        <div className="hint">Full file — drop it straight into the plugin's config folder.</div>
        {downloadStatus && <div className="status-msg">{downloadStatus}</div>}

        <button type="button" className="export-btn" onClick={onSaveBrowser} style={{ marginTop: 14 }}>
          <Save size={15} /> Save to browser
        </button>
        <div className="hint">Keeps a copy in this browser so you can pick up where you left off from the Import screen.</div>
        {saveBrowserStatus && <div className="status-msg">{saveBrowserStatus}</div>}
      </div>

      <div className="export-preview">
        <div className="export-preview-header">animations.yml</div>
        <textarea className="yaml-preview export-yaml" readOnly value={fullYaml} spellCheck={false} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline (bottom panel)                                           */
/* ------------------------------------------------------------------ */

const TRACK_ROW_HEIGHT = 38;

function Timeline({
  steps, selectedStep, setSelectedStep, interval, addStep, duplicateStep, deleteStep,
  zoom, setZoom, playheadRef, lockedParts, hiddenParts, toggleLocked, toggleHidden,
  onDotContextMenu, onTimelineContextMenu, selectedDots, setSelectedDots, isPlaying, onMoveStep,
  scrollAreaRef, partOrder, setPartOrder,
}) {
  const partDragRef = useRef(null);
  const onPartDragStart = (part) => { partDragRef.current = part; };
  const onPartDragOverRow = (e, overPart) => {
    e.preventDefault();
    if (!partDragRef.current || partDragRef.current === overPart) return;
    setPartOrder((prev) => {
      const from = prev.indexOf(partDragRef.current);
      const to = prev.indexOf(overPart);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, partDragRef.current);
      return next;
    });
  };
  const onPartDragEnd = () => { partDragRef.current = null; };
  const dotDragRef = useRef(null);
  const stepWidth = 64 * zoom;
  const totalWidth = Math.max(steps.length * stepWidth + 60, 360);
  const trackRef = useRef(null);
  const tracksAreaRef = useRef(null);
  const dragRef = useRef(null);

  const [marqueeRect, setMarqueeRect] = useState(null);
  const [marqueeFading, setMarqueeFading] = useState(false);

  const stepIndexFromClientX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(steps.length - 1, Math.round(x / stepWidth)));
  };
  const handleBgContextMenu = (e) => {
    if (e.target.closest('.keyframe-dot')) return;
    onTimelineContextMenu(e, stepIndexFromClientX(e.clientX));
  };

  const onDotPointerDown = (e, part, idx) => {
    dotDragRef.current = { part, fromIdx: idx, startX: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDotPointerMove = (e) => {
    const d = dotDragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.startX) > 4) d.moved = true;
  };
  const onDotPointerUp = (e, part, idx) => {
    const d = dotDragRef.current;
    dotDragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      setSelectedDots(new Set());
      setSelectedStep(idx);
      return;
    }
    const targetIdx = stepIndexFromClientX(e.clientX);
    if (targetIdx !== d.fromIdx) onMoveStep(d.fromIdx, targetIdx, e.altKey);
  };

  const handleDragRef = useRef(false);
  const onHandlePointerDown = (e) => {
    handleDragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedStep(stepIndexFromClientX(e.clientX));
  };
  const onHandlePointerMove = (e) => {
    if (!handleDragRef.current) return;
    setSelectedStep(stepIndexFromClientX(e.clientX));
  };
  const onHandlePointerUp = () => { handleDragRef.current = false; };

  const handleRulerClick = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(steps.length - 1, Math.round(x / stepWidth)));
    setSelectedDots(new Set());
    setSelectedStep(idx);
  };

  const onMarqueeDown = (e) => {
    if (e.target.closest('.keyframe-dot')) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const rect = tracksAreaRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    dragRef.current = { startX, startY, rectSnapshot: rect };
    setMarqueeFading(false);
    setMarqueeRect({ left: startX, top: startY, width: 0, height: 0 });
    if (e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };
  const computeSelection = (rect) => {
    if (!(rect.width > 3 || rect.height > 3)) return new Set();
    const next = new Set();
    PARTS.forEach((part, rowIdx) => {
      const rowTop = rowIdx * TRACK_ROW_HEIGHT;
      const rowBottom = rowTop + TRACK_ROW_HEIGHT;
      if (rowBottom < rect.top || rowTop > rect.top + rect.height) return;
      steps.forEach((_, i) => {
        const dotX = i * stepWidth + stepWidth / 2;
        if (dotX >= rect.left && dotX <= rect.left + rect.width) next.add(`${part}-${i}`);
      });
    });
    return next;
  };
  const onMarqueeMove = (e) => {
    if (!dragRef.current) return;
    const rect = dragRef.current.rectSnapshot;
    const maxX = rect.width;
    const maxY = rect.height;
    const curX = Math.max(0, Math.min(maxX, e.clientX - rect.left));
    const curY = Math.max(0, Math.min(maxY, e.clientY - rect.top));
    const left = Math.min(dragRef.current.startX, curX);
    const top = Math.min(dragRef.current.startY, curY);
    const width = Math.abs(curX - dragRef.current.startX);
    const height = Math.abs(curY - dragRef.current.startY);
    setMarqueeRect({ left, top, width, height });
    setSelectedDots(computeSelection({ left, top, width, height }));
  };
  const onMarqueeUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setMarqueeRect((rect) => {
      if (rect) setSelectedDots(computeSelection(rect));
      return rect;
    });
    setMarqueeFading(true);
    setTimeout(() => { setMarqueeRect(null); setMarqueeFading(false); }, 300);
  };

  // Safety net: if the pointer is released (or the window loses it) anywhere,
  // even outside the timeline or the browser viewport, always finish the drag.
  const onMarqueeUpRef = useRef(onMarqueeUp);
  onMarqueeUpRef.current = onMarqueeUp;
  useEffect(() => {
    const finalize = () => { if (dragRef.current) onMarqueeUpRef.current(); };
    window.addEventListener('pointerup', finalize);
    window.addEventListener('pointercancel', finalize);
    window.addEventListener('blur', finalize);
    return () => {
      window.removeEventListener('pointerup', finalize);
      window.removeEventListener('pointercancel', finalize);
      window.removeEventListener('blur', finalize);
    };
  }, []);

  return (
    <div className="timeline-main">
      <div className="tool-strip">
        <button type="button" className="tool-btn active" title="Selection tool"><MousePointer2 size={16} /></button>
        <div className="tool-sep" />
        <button type="button" className="tool-btn" onClick={addStep} title="Add step"><Plus size={16} /></button>
        <button type="button" className="tool-btn" onClick={() => duplicateStep(selectedStep)} title="Duplicate step"><Copy size={16} /></button>
        <button type="button" className="tool-btn" onClick={() => deleteStep(selectedStep)} disabled={steps.length <= 1} title="Delete step"><Trash2 size={16} /></button>
        <div className="tool-sep" />
        <button type="button" className="tool-btn" onClick={() => setZoom((z) => Math.min(2.5, round1(z + 0.2)))} title="Zoom in"><ZoomIn size={16} /></button>
        <button type="button" className="tool-btn" onClick={() => setZoom((z) => Math.max(0.5, round1(z - 0.2)))} title="Zoom out"><ZoomOut size={16} /></button>
      </div>

      <div className="timeline-tracks-header">
        <div className="track-header-spacer" />
        {partOrder.map((part) => {
          const locked = !!lockedParts[part];
          const hidden = !!hiddenParts[part];
          return (
            <div
              key={part}
              className={`track-header-row${hidden ? ' is-hidden' : ''}`}
              draggable
              onDragStart={() => onPartDragStart(part)}
              onDragOver={(e) => onPartDragOverRow(e, part)}
              onDragEnd={onPartDragEnd}
              title="Drag to reorder this track"
            >
              <button type="button" className="mini-icon-btn" onClick={() => toggleLocked(part)} title={locked ? 'Unlock track' : 'Lock track'}>
                {locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button type="button" className="mini-icon-btn" onClick={() => toggleHidden(part)} title={hidden ? 'Show in preview' : 'Hide from preview'}>
                {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <span className="badge-chip" style={{ borderColor: PART_META[part].color, color: PART_META[part].color }}>
                {PART_META[part].badge}
              </span>
              <span className="track-name">{PART_META[part].label}</span>
            </div>
          );
        })}
      </div>

      <div className="timeline-scroll" ref={scrollAreaRef}>
        <div className="timeline-body" ref={trackRef} style={{ minWidth: totalWidth }}>
          <div className="ruler" onClick={handleRulerClick} onContextMenu={handleBgContextMenu}>
            {steps.map((_, i) => (
              <div key={i} className="ruler-tick" style={{ left: i * stepWidth }}>
                <span>{i * interval}t</span>
              </div>
            ))}
          </div>

          <div
            className="tracks-area"
            ref={tracksAreaRef}
            onPointerDown={onMarqueeDown}
            onPointerMove={onMarqueeMove}
            onPointerUp={onMarqueeUp}
            onContextMenu={handleBgContextMenu}
          >
            {partOrder.map((part) => {
              const hidden = !!hiddenParts[part];
              return (
                <div key={part} className={`track-row${hidden ? ' is-hidden' : ''}`}>
                  {steps.map((_, i) => (
                    <button
                      type="button"
                      key={i}
                      className={`keyframe-dot${i === selectedStep ? ' active' : ''}${selectedDots.has(`${part}-${i}`) ? ' marquee-selected' : ''}`}
                      style={{ left: i * stepWidth + stepWidth / 2 - 6, background: PART_META[part].color }}
                      onPointerDown={(e) => onDotPointerDown(e, part, i)}
                      onPointerMove={onDotPointerMove}
                      onPointerUp={(e) => onDotPointerUp(e, part, i)}
                      onContextMenu={(e) => onDotContextMenu(e, part, i)}
                      title={`${PART_META[part].label} — step ${i + 1} (drag to move, alt-drag to copy)`}
                    />
                  ))}
                </div>
              );
            })}

            {marqueeRect && (
              <div
                className={`marquee-box${marqueeFading ? ' fading' : ''}`}
                style={{
                  left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height,
                }}
              />
            )}
          </div>

          <div
            className="playhead-wrap"
            ref={playheadRef}
            style={{ left: selectedStep * stepWidth + stepWidth / 2 }}
          >
            <div
              className="playhead-handle"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              title="Drag to scrub"
            />
            <div className="playhead-line" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Menu bar (fully functional dropdowns)                             */
/* ------------------------------------------------------------------ */

function MenuBar({ menus, openMenu, setOpenMenu, onAction, flags }) {
  return (
    <div className="menu-bar">
      {Object.keys(menus).map((name) => (
        <div key={name} className="menu-wrap">
          <div
            className={`menu-item${openMenu === name ? ' open' : ''}`}
            onClick={() => setOpenMenu((m) => (m === name ? null : name))}
          >
            {name}
          </div>
          {openMenu === name && (
            <div className="menu-dropdown">
              {menus[name].map((item, idx) => (
                item.divider ? (
                  <div key={`d${idx}`} className="menu-divider" />
                ) : (
                  <button
                    type="button"
                    key={item.action}
                    className="menu-dd-item"
                    disabled={item.disabledKey ? !flags[item.disabledKey] : false}
                    onClick={() => { onAction(item.action); setOpenMenu(null); }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                )
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal (prompt / confirm / info / import)                          */
/* ------------------------------------------------------------------ */

function Modal({ modal, onClose, savePref }) {
  const [value, setValue] = useState('');
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [importPick, setImportPick] = useState('');

  useEffect(() => {
    if (modal) {
      setValue(modal.initial ?? '');
      setImportText('');
      setError('');
      setImportPick('');
      setChecked(false);
    }
  }, [modal]);
  const importNames = listAnimationNames(importText);
  useEffect(() => {
    if (importNames.length && !importNames.includes(importPick)) setImportPick(importNames[0]);
  }, [importText]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!modal) return null;

  const submit = () => {
    if (modal.kind === 'prompt') {
      modal.onSubmit(value);
      onClose();
    } else if (modal.kind === 'confirm') {
      modal.onConfirm(checked);
      onClose();
    } else if (modal.kind === 'import') {
      const parsed = parseAnimationYaml(importText, importPick);
      if (!parsed) {
        setError("Couldn't find a valid animation in that text — needs a name, interval, loop and steps.");
        return;
      }
      modal.onImport(parsed);
      onClose();
    } else {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-box${modal.kind === 'import' ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{modal.title}</div>

        {modal.kind === 'prompt' && (
          <input
            autoFocus
            className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        )}

        {modal.kind === 'save' && (
          <>
            <div className="modal-body" style={{ textAlign: 'left' }}>{modal.message}</div>
            <button
              type="button"
              className={`modal-big-btn${modal.selectMode && savePref === 'export' ? ' selected' : ''}`}
              onClick={() => { modal.onExport(checked); if (!modal.selectMode) onClose(); }}
            >
              <Download size={20} />
              Export file
              {modal.selectMode && savePref === 'export' && <Check size={16} className="modal-big-btn-check" />}
            </button>
            <button
              type="button"
              className={`modal-big-btn${modal.selectMode && savePref === 'browser' ? ' selected' : ''}`}
              onClick={() => { modal.onSaveBrowser(checked); if (!modal.selectMode) onClose(); }}
            >
              <Save size={20} />
              Save to browser
              {modal.selectMode && savePref === 'browser' && <Check size={16} className="modal-big-btn-check" />}
            </button>
          </>
        )}
        {modal.kind === 'confirm' && <div className="modal-body">{modal.message}</div>}
        {(modal.kind === 'confirm' || modal.kind === 'save') && modal.showCheckbox && !modal.selectMode && (
          <label className="field checkbox-field">
            <span>
              {modal.checkboxLabel}
              <span className="help-icon-wrap">
                <button
                  type="button"
                  className="help-icon-btn"
                  onClick={() => setHelpOpen((h) => !h)}
                  onMouseEnter={() => setHelpOpen(true)}
                  onMouseLeave={() => setHelpOpen(false)}
                >
                  <HelpCircle size={13} />
                </button>
                {helpOpen && (
                  <div className="help-tooltip">
                    Checking this remembers whichever button you click (Export file or Save to browser) and does that
                    same one automatically every time you hit Ctrl/⌘ S, no popup. Undo it anytime from
                    File → Reset save preference.
                  </div>
                )}
              </span>
            </span>
            <button type="button" className={`tick-box${checked ? ' on' : ''}`} onClick={() => setChecked((c) => !c)}>
              {checked && <Check size={12} />}
            </button>
          </label>
        )}

        {modal.kind === 'info' && <div className="modal-body">{modal.body}</div>}

        {modal.kind === 'import' && (
          <>
            <div className="modal-body">Paste your <code>animations.yml</code> (or just one animation block) below.</div>
            <textarea
              autoFocus
              className="yaml-preview" spellCheck={false} autoCorrect="off" autoCapitalize="off"
              style={{ minHeight: 200 }}
              value={importText}
              onChange={(e) => { setImportText(e.target.value); setError(''); }}
              placeholder={'wave:\n  interval: 10\n  loop: true\n  realistic-animations:\n    enabled: false\n    frames: 1\n  steps:\n    - head:\n        x: 0\n        ...'}
            />
            {importNames.length > 1 && (
              <label className="field">
                <span>Found {importNames.length} animations — import which one?</span>
                <select className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={importPick} onChange={(e) => setImportPick(e.target.value)}>
                  {importNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {error && <div className="modal-error">{error}</div>}
          </>
        )}

        <div className="modal-actions">
          {modal.kind !== 'info' && modal.kind !== 'save' && (
            <button type="button" className="export-btn" onClick={onClose}>Cancel</button>
          )}
          {modal.kind !== 'info' && modal.kind !== 'save' && (
            <button type="button" className="export-btn primary" onClick={submit}>
              {modal.confirmLabel || 'OK'}
            </button>
          )}
          {(modal.kind === 'info' || modal.kind === 'save') && (
            <button type="button" className="export-btn primary" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom cursors (dark, Figma-ish)                                  */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/*  Custom right-click context menu                                   */
/* ------------------------------------------------------------------ */

function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('contextmenu', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('contextmenu', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const estWidth = 220;
  const estHeight = menu.items.length * 30 + 12;
  const left = Math.max(6, Math.min(menu.x, window.innerWidth - estWidth - 6));
  const top = Math.max(6, Math.min(menu.y, window.innerHeight - estHeight - 6));

  return (
    <div className="context-menu" ref={ref} style={{ left, top }}>
      {menu.items.map((item, idx) => {
        if (item.divider) return <div key={`d${idx}`} className="menu-divider" />;
        if (item.header) return <div key={`h${idx}`} className="context-menu-header">{item.label}</div>;
        return (
          <button
            type="button"
            key={item.label}
            className={`menu-dd-item${item.danger ? ' danger' : ''}`}
            disabled={!!item.disabled}
            onClick={() => { item.action(); onClose(); }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const CSS = `
* { box-sizing: border-box; }
.aas-app {
  cursor: default;
  display: flex; flex-direction: column;
  height: 100vh; min-height: 560px;
  background: #1b1b1b; color: #d8d8d6;
  font-family: 'Inter', -apple-system, "Segoe UI", ui-sans-serif, Roboto, sans-serif;
  overflow: hidden; font-size: 13px;
  user-select: none; -webkit-user-select: none; -moz-user-select: none;
}
button { font-family: inherit; }

.menu-bar { flex-shrink:0; height:28px; display:flex; align-items:center; gap:2px; background:#181818; border-bottom:1px solid #060606; padding:0 8px; position:relative; z-index:40; }
.menu-wrap { position:relative; }
.menu-item { font-size:12px; color:#a7a7a7; padding:4px 10px; border-radius:3px; cursor:default; user-select:none; }
.menu-item:hover, .menu-item.open { background:#2b2b2b; color:#fff; }
.menu-dropdown { position:absolute; top:100%; left:0; margin-top:2px; background:#242424; border:1px solid #3a3a3a; border-radius:12px; min-width:220px; padding:5px; box-shadow:0 10px 30px #000000aa; z-index:50; }
.menu-dd-item { width:100%; display:flex; align-items:center; justify-content:space-between; gap:16px; background:none; border:none; color:#e0e0e0; padding:3px 10px; font-size:12.5px; border-radius:4px; cursor:pointer; text-align:left; }
.menu-dd-item:hover:not(:disabled) { background:#2f8fef; color:#fff; }
.menu-dd-item:disabled { opacity:0.35; cursor:not-allowed; }
.menu-shortcut { font-size:11px; color:#8a8a8a; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.menu-dd-item:hover:not(:disabled) .menu-shortcut { color:#dbe9ff; }
.menu-divider { height:1px; background:#3a3a3a; margin:5px 4px; }

.toolbar { flex-shrink:0; height:46px; display:flex; align-items:center; gap:14px; padding:0 12px; background:#212121; border-bottom:1px solid #060606; }
.workspace-tabs { display:flex; gap:4px; background:#181818; border-radius:6px; padding:3px; }
.workspace-tab { font-size:12px; padding:5px 12px; border-radius:4px; color:#9a9a9a; cursor:default; }
.workspace-tab:hover { color:#e0e0e0; }
.workspace-tab.active { background:#3a3a3c; color:#fff; }
.toolbar-title { font-size:12.5px; color:#8b8b8b; }
.toolbar-spacer { flex:1; }
.icon-ghost-btn { display:flex; align-items:center; justify-content:center; width:30px; height:30px; background:transparent; border:1px solid transparent; border-radius:5px; color:#b7b7b7; cursor:default; }
.icon-ghost-btn:hover { background:#2c2c2e; border-color:#3a3a3c; color:#fff; }

.body-row { flex:1; min-height:0; display:flex; }

.panel { overflow-y:auto; padding:0; background:#202020; display:flex; flex-direction:column; }
.panel::-webkit-scrollbar { width:11px; height:11px; }
.panel::-webkit-scrollbar-track { background:#161616; }
.panel::-webkit-scrollbar-thumb { background:#3a3a3c; border-radius:7px; border:2px solid #161616; }
.panel::-webkit-scrollbar-thumb:hover { background:#4d4d50; }
.panel { scrollbar-width: thin; scrollbar-color: #3a3a3c #161616; }
.export-side, .parts-list, .tab-panel { scrollbar-width: thin; scrollbar-color: #3a3a3c #161616; }
.export-side::-webkit-scrollbar, .parts-list::-webkit-scrollbar, .tab-panel::-webkit-scrollbar { width:11px; height:11px; }
.export-side::-webkit-scrollbar-track, .parts-list::-webkit-scrollbar-track, .tab-panel::-webkit-scrollbar-track { background:#161616; }
.export-side::-webkit-scrollbar-thumb, .parts-list::-webkit-scrollbar-thumb, .tab-panel::-webkit-scrollbar-thumb { background:#3a3a3c; border-radius:7px; border:2px solid #161616; }
.export-side::-webkit-scrollbar-thumb:hover, .parts-list::-webkit-scrollbar-thumb:hover, .tab-panel::-webkit-scrollbar-thumb:hover { background:#4d4d50; }
.parts-panel { width:320px; flex-shrink:0; border-right:1px solid #060606; }
.settings-panel { width:300px; flex-shrink:0; border-left:1px solid #060606; }
.dock-panel { width:310px; flex-shrink:0; }
.dock-panel.drop-target { outline:2px solid #2f8fef; outline-offset:-2px; }
.dock-panel:first-child { border-right:1px solid #060606; }
.dock-panel:last-child { border-left:1px solid #060606; }
.dock-panel .tab-strip { position:relative; }
.dock-panel .tab[draggable] { cursor:grab; }
.dock-panel .tab[draggable]:active { cursor:grabbing; }
.dock-drop-hint { position:absolute; inset:0; background:#2f8fef22; border:1.5px dashed #2f8fef; pointer-events:none; }
.dock-empty-strip { width:10px; flex-shrink:0; background:#161616; transition: width 0.12s ease; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.dock-empty-strip.drop-target { width:130px; background:#2f8fef22; border-left:1.5px dashed #2f8fef; border-right:1.5px dashed #2f8fef; }
.dock-empty-strip span { writing-mode: vertical-rl; font-size:11px; color:#2f8fef; white-space:nowrap; opacity:0; transition: opacity 0.1s; }
.dock-empty-strip.drop-target span { opacity:1; }
.dock-panel.horizontal { width:100%; height:160px; flex-shrink:0; border-top:1px solid #060606; border-right:none; border-left:none; }
.dock-empty-strip.horizontal { width:100%; height:8px; flex-shrink:0; }
.dock-empty-strip.horizontal.drop-target { height:120px; border-top:1.5px dashed #2f8fef; border-bottom:1.5px dashed #2f8fef; border-left:none; }
.dock-empty-strip.horizontal span { writing-mode: horizontal-tb; }
.dock-rail { width:38px; flex-shrink:0; background:#181818; display:flex; flex-direction:column; align-items:center; padding:8px 0; gap:6px; }
.dock-rail-left { border-right:1px solid #060606; }
.dock-rail-right { border-left:1px solid #060606; }
.dock-rail-btn { width:28px; height:28px; border-radius:5px; background:none; border:none; color:#9a9a9a; font-size:10px; font-weight:700; letter-spacing:.02em; display:flex; align-items:center; justify-content:center; cursor:pointer; }
.dock-rail-btn:hover { background:#2c2c2e; color:#fff; }
.dock-rail-toggle { display:flex; align-items:center; justify-content:center; width:24px; margin-left:auto; background:none; border:none; color:#7a7a7a; cursor:pointer; }
.dock-rail-toggle:hover { color:#fff; }

.tab-strip { display:flex; border-bottom:1px solid #060606; background:#1c1c1c; flex-shrink:0; }
.tab { font-size:12px; padding:9px 14px; color:#8a8a8a; cursor:default; border-bottom:2px solid transparent; }
.tab:hover { color:#d8d8d6; }
.tab.active { color:#fff; border-bottom-color:#2f8fef; background:#222; }
.tab-panel { padding:14px; overflow-y:auto; }

.panel-sub { font-size:11px; color:#6f6f6f; padding:10px 14px 4px; }
.parts-list { padding: 0 10px 14px; overflow-y:auto; }

.part-block { border-bottom:1px solid #262626; padding:5px 0; }
.part-block.is-hidden { opacity:0.45; }
.part-head { display:flex; align-items:center; gap:8px; width:100%; background:none; border:none; color:#d8d8d6; padding:7px 4px; cursor:default; border-radius:4px; font-size:12.5px; }
.part-head:hover { background:#272727; }
.badge-chip { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:9.5px; font-weight:700; border:1px solid; border-radius:3px; padding:1px 4px; letter-spacing:0.03em; flex-shrink:0; }
.part-label { font-weight:500; flex:1; text-align:left; }
.inline-flag { color:#e0a53f; flex-shrink:0; }
.prop-list { padding: 2px 6px 6px 6px; }
.prop-row { display:flex; align-items:center; gap:6px; height:28px; padding:0 4px 0 22px; border-radius:3px; }
.prop-row:hover { background:#242424; }
.prop-label { font-size:11px; color:#a8a8a8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.prop-spacer { flex:1; min-width:6px; }
.stopwatch-btn { display:flex; align-items:center; justify-content:center; width:18px; height:18px; flex-shrink:0; background:none; border:none; border-radius:3px; color:#5c5c5c; cursor:default; }
.stopwatch-btn.on { color: var(--accent); }
.stopwatch-btn:hover:not(:disabled) { background:#2f8fef22; color:#2f8fef; }
.stopwatch-btn:disabled { cursor:default; opacity:0.5; }
.prop-row .num-field { width:58px; flex-shrink:0; padding:2px 3px; }
.keyframe-nav { display:flex; align-items:center; gap:1px; flex-shrink:0; }
.kf-nav-btn, .kf-reset-btn { display:flex; align-items:center; justify-content:center; width:18px; height:18px; background:none; border:none; color:#6d6d6d; cursor:default; border-radius:3px; }
.kf-nav-btn:hover:not(:disabled), .kf-reset-btn:hover:not(:disabled) { background:#2c2c2e; color:#fff; }
.kf-nav-btn:disabled { opacity:0.25; cursor:default; }
.kf-reset-btn:disabled { opacity:0.25; cursor:default; }

.num-field { display:inline-flex; justify-content:center; align-items:center; width:100%; padding:2px; cursor:ew-resize; user-select:none; }
.num-field.disabled { opacity:0.4; cursor:not-allowed; }
.num-value { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:12px; font-variant-numeric: tabular-nums; color:#4da3ff; }
.num-field:not(.disabled):hover .num-value { text-decoration: underline; text-underline-offset: 2px; }
.num-input { width:100%; background:transparent; border:none; outline:none; color:#4da3ff; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:12px; text-align:center; }

.viewport-panel { flex:1; min-width:0; display:flex; flex-direction:column; background:#141414; }
.viewport-wrap { flex:1; min-height:0; position:relative; }
.viewport-canvas { width:100%; height:100%; cursor:grab; }
.viewport-readout { position:absolute; top:10px; left:12px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:16px; color:#2f8fef; text-shadow:0 1px 3px #000; letter-spacing:0.02em; }
.viewport-readout .sub { font-size:11px; color:#9a9a9a; display:block; margin-top:2px; }
.viewport-hint { position:absolute; bottom:10px; left:50%; transform:translateX(-50%); font-size:11px; color:#7a7a7a; background:#000000aa; padding:4px 10px; border-radius:20px; pointer-events:none; }

.scrub-strip { height:22px; background:#1c1c1c; border-top:1px solid #060606; position:relative; cursor:ew-resize; flex-shrink:0; }
.scrub-fill { position:absolute; top:0; bottom:0; left:0; background:#2f8fef33; transition: width 0.12s ease-out; }
.scrub-marker { position:absolute; top:2px; bottom:2px; width:3px; margin-left:-1.5px; background:#2f8fef; border-radius:2px; box-shadow:0 0 5px #2f8fefcc; transition: left 0.12s ease-out; }
.scrub-strip.playing .scrub-fill, .scrub-strip.playing .scrub-marker { transition: none; }
.scrub-time { position:absolute; top:0; bottom:0; right:8px; display:flex; align-items:center; gap:3px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:10.5px; color:#cfe3ff; pointer-events:none; text-shadow:0 1px 2px #000; }
.scrub-step-readout { position:absolute; top:0; bottom:0; left:8px; display:flex; align-items:center; gap:6px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:10.5px; color:#cfe3ff; pointer-events:none; text-shadow:0 1px 2px #000; }
.scrub-step-readout .sub { color:#8a8a8a; }
.scrub-time-total { color:#7a7a7a; }

.transport-bar { height:44px; flex-shrink:0; display:flex; align-items:center; justify-content:center; gap:6px; background:#1c1c1c; border-top:1px solid #060606; }
.transport-btn { display:flex; align-items:center; justify-content:center; width:32px; height:32px; background:transparent; border:none; border-radius:6px; color:#c9c9c9; cursor:default; }
.transport-btn:hover { background:#2c2c2e; color:#fff; }
.transport-btn.play { width:38px; height:38px; background:#2f8fef; color:#fff; }
.transport-btn.play:hover { background:#4fa3ff; }
.transport-btn.on { color:#2f8fef; }

.field { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; font-size:12px; color:#9a9a9a; }
.text-input { background:#161616; border:1px solid #333; border-radius:5px; color:#e6e6e6; padding:7px 9px; font-size:13px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; width:100%; }
.text-input:focus, .num-input:focus, textarea:focus { outline:none; border-color:#2f8fef; }
.checkbox-field { flex-direction:row; align-items:center; justify-content:space-between; }
.toggle { width:36px; height:20px; border-radius:12px; background:#333; border:none; position:relative; cursor:default; padding:2px; }
.toggle.on { background:#2f8fef; }
.toggle-knob { display:block; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform 0.15s; }
.toggle.on .toggle-knob { transform:translateX(16px); }
.tick-box { width:18px; height:18px; border-radius:5px; border:1px solid #444; background:#161616; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#fff; padding:0; flex-shrink:0; }
.tick-box.on { background:#2f8fef; border-color:#2f8fef; }
.field-disabled { opacity:0.4; }
.field-disabled .text-input { cursor:not-allowed; }
.aas-app button:not(:disabled) { cursor:pointer; }
.aas-app button:disabled { cursor:not-allowed; }



.stat-row { display:flex; gap:10px; margin:14px 0 6px; }
.stat-row > div { flex:1; background:#161616; border:1px solid #333; border-radius:6px; padding:8px 10px; text-align:center; }
.stat-num { display:block; font-size:16px; font-weight:700; color:#2f8fef; }
.stat-label { font-size:10.5px; color:#7a7a7a; text-transform:uppercase; letter-spacing:0.04em; }

.export-btn { display:flex; align-items:center; justify-content:center; gap:8px; background:#161616; border:1px solid #333; color:#e6e6e6; padding:9px 14px; border-radius:6px; cursor:default; font-size:12.5px; font-weight:600; }
.export-btn:hover { border-color:#4a4a4a; }
.export-btn.primary { background:#2f8fef; color:#fff; border-color:#2f8fef; }
.export-btn.primary:hover { background:#4fa3ff; }
.tab-panel .export-btn { width:100%; }
.hint { font-size:11px; color:#7a7a7a; margin-top:6px; line-height:1.4; }
.hint code { color:#c8c6bf; background:#161616; padding:1px 4px; border-radius:3px; }
.status-msg { margin-top:6px; font-size:11.5px; color:#66d19e; }
.yaml-preview { width:100%; height:100%; min-height:260px; background:#101010; border:1px solid #333; border-radius:6px; color:#8fb8ef; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:11px; line-height:1.5; padding:10px; resize:vertical; scrollbar-width: thin; scrollbar-color: #3a3a3c #101010; }
.yaml-preview::-webkit-scrollbar { width:11px; height:11px; }
.yaml-preview::-webkit-scrollbar-track { background:#101010; }
.yaml-preview::-webkit-scrollbar-thumb { background:#3a3a3c; border-radius:7px; border:2px solid #101010; }
.yaml-preview::-webkit-scrollbar-thumb:hover { background:#4d4d50; }

.resize-handle { flex-shrink:0; height:6px; background:#181818; border-top:1px solid #060606; border-bottom:1px solid #060606; cursor:ns-resize; position:relative; }
.resize-handle:hover, .resize-handle.active { background:#2f8fef44; }
.resize-handle::after { content:''; position:absolute; left:50%; top:50%; width:32px; height:2px; background:#4a4a4a; transform:translate(-50%,-50%); border-radius:2px; }

.timeline-main { flex-shrink:0; width:100%; height:100%; display:flex; background:#1a1a1a; overflow:hidden; }
.tool-strip { width:38px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 0; background:#181818; border-right:1px solid #060606; }
.tool-btn { display:flex; align-items:center; justify-content:center; width:28px; height:28px; background:transparent; border:none; border-radius:5px; color:#9a9a9a; cursor:default; }
.tool-btn:hover:not(:disabled) { background:#2c2c2e; color:#fff; }
.tool-btn.active { background:#2f8fef; color:#fff; }
.tool-btn:disabled { opacity:0.3; cursor:not-allowed; }
.tool-sep { width:20px; height:1px; background:#333; margin:4px 0; }

.timeline-tracks-header { width:172px; flex-shrink:0; background:#1e1e1e; border-right:1px solid #060606; overflow:hidden; }
.track-header-spacer { height:28px; border-bottom:1px solid #060606; background:#181818; }
.timeline-step-readout { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size:10.5px; color:#c9c9c9; padding:0 8px; display:flex; align-items:center; gap:6px; height:100%; }
.timeline-step-readout .sub { color:#6d6d6d; }
.viewport-settings { position:absolute; top:10px; left:12px; z-index:8; }
.viewport-settings-btn { width:26px; height:26px; display:flex; align-items:center; justify-content:center; background:none; border:none; border-radius:50%; color:#9a9a9a; cursor:pointer; }
.viewport-settings-btn:hover { background:#ffffff1a; color:#fff; }
.viewport-lock-btn { position:absolute; bottom:10px; left:12px; width:26px; height:26px; display:flex; align-items:center; justify-content:center; background:none; border:none; border-radius:50%; color:#9a9a9a; cursor:pointer; z-index:8; }
.viewport-lock-btn:hover { background:#ffffff1a; color:#fff; }

.viewport-settings-menu { position:absolute; top:34px; left:0; background:#242424; border:1px solid #3a3a3a; border-radius:10px; padding:5px; min-width:150px; box-shadow:0 10px 30px #000000aa; }

.track-header-row { display:flex; align-items:center; gap:6px; height:38px; padding:0 8px; font-size:11.5px; color:#c9c9c9; white-space:nowrap; border-bottom:1px solid #262626; }
.track-header-row.is-hidden { opacity:0.4; }
.track-name { overflow:hidden; text-overflow:ellipsis; }
.mini-icon-btn { display:flex; align-items:center; justify-content:center; width:18px; height:18px; background:transparent; border:none; color:#8a8a8a; cursor:default; border-radius:3px; flex-shrink:0; }
.mini-icon-btn:hover { background:#2c2c2e; color:#fff; }

.timeline-scroll { flex:1; overflow:auto; scrollbar-width: thin; scrollbar-color: #3a3a3c #161616; }
.timeline-scroll::-webkit-scrollbar { width:11px; height:11px; }
.timeline-scroll::-webkit-scrollbar-track { background:#161616; }
.timeline-scroll::-webkit-scrollbar-thumb { background:#3a3a3c; border-radius:7px; border:2px solid #161616; }
.timeline-scroll::-webkit-scrollbar-thumb:hover { background:#4d4d50; }
.timeline-scroll::-webkit-scrollbar-corner { background:#161616; }
.timeline-body { position:relative; width:100%; }
.ruler { position:relative; width:100%; height:28px; border-bottom:1px solid #060606; background:#181818; cursor:default; }
.ruler-tick { position:absolute; top:0; bottom:0; border-left:1px solid #333; padding-left:5px; display:flex; align-items:center; }
.ruler-tick span { font-size:10px; color:#767676; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.track-row { position:relative; width:100%; height:38px; border-bottom:1px solid #262626; }
.track-row.is-hidden { opacity:0.35; }
.track-row:nth-child(odd) { background:#1c1c1c; }
.keyframe-dot { position:absolute; top:50%; width:12px; height:12px; border:1.5px solid #0008; border-radius:3px; transform:translateY(-50%) rotate(45deg); cursor:default; padding:0; }
.keyframe-dot.active { border-color:#fff; box-shadow:0 0 0 2px #2f8fef88; }
.keyframe-dot.marquee-selected { border-color:#fff; box-shadow:0 0 0 2px #2f8fef, 0 0 8px 1px #2f8fefaa; }
.tracks-area { position:relative; user-select:none; -webkit-user-select:none; touch-action:none; }
.tracks-area * { -webkit-user-drag:none; user-drag:none; }
.marquee-box { position:absolute; border:1.5px solid #2f8fef; background:#2f8fef26; border-radius:8px; pointer-events:none; z-index:6; opacity:1; transition: opacity 0.3s ease-out; }
.marquee-box.fading { opacity:0; }
.playhead-wrap { position:absolute; top:0; bottom:0; width:0; pointer-events:none; z-index:7; }
.playhead-line { position:absolute; top:0; bottom:0; left:-1px; width:2px; background:#2f8fef; box-shadow:0 0 6px #2f8fefcc; pointer-events:none; }
.playhead-handle { position:absolute; top:0; left:-7px; width:14px; height:13px; background:#2f8fef; clip-path: polygon(0% 0%, 100% 0%, 100% 62%, 50% 100%, 0% 62%); cursor: ew-resize; pointer-events:auto; box-shadow:0 0 6px #2f8fefaa; }
.playhead-handle:hover, .playhead-handle:active { background:#4fa3ff; }

.export-workspace { flex:1; min-height:0; display:flex; background:#181818; }
.export-side { width:320px; flex-shrink:0; padding:20px; border-right:1px solid #060606; overflow-y:auto; background:#202020; display:flex; flex-direction:column; scrollbar-width: thin; scrollbar-color: #3a3a3c #202020; }
.export-side::-webkit-scrollbar { width:11px; }
.export-side::-webkit-scrollbar-track { background:#202020; }
.export-side::-webkit-scrollbar-thumb { background:#3a3a3c; border-radius:7px; border:2px solid #202020; }
.export-side::-webkit-scrollbar-thumb:hover { background:#4d4d50; }
.export-side-header { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#9a9a9a; margin-bottom:14px; }
.export-summary { background:#161616; border:1px solid #333; border-radius:8px; padding:12px 14px; margin-bottom:20px; display:flex; flex-direction:column; gap:8px; }
.summary-row { display:flex; justify-content:space-between; font-size:12.5px; color:#9a9a9a; }
.summary-row b { color:#e6e6e6; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight:600; }
.export-preview { flex:1; min-width:0; display:flex; flex-direction:column; padding:20px; }
.export-preview-header { font-size:12px; color:#7a7a7a; margin-bottom:8px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.export-yaml { flex:1; min-height:0; height:100%; font-size:12.5px; }

.modal-overlay { position:fixed; inset:0; background:#000000aa; display:flex; align-items:center; justify-content:center; z-index:100; }
.modal-box { width:400px; max-width:90vw; background:#212121; border:1px solid #3a3a3a; border-radius:8px; padding:18px; box-shadow:0 20px 60px #000000cc; }
.modal-box.wide { width:560px; }
.modal-title { font-size:14px; font-weight:700; margin-bottom:12px; color:#fff; }
.modal-body { font-size:12.5px; color:#b8b8b8; line-height:1.5; margin-bottom:12px; }
.modal-body code { color:#8fb8ef; background:#161616; padding:1px 4px; border-radius:3px; }
.modal-body a { color:#4fa3ff; cursor: pointer; }
a { cursor: pointer; }
.modal-error { font-size:11.5px; color:#f47272; margin-top:8px; }
.help-icon-wrap { position:relative; display:inline-flex; margin-left:5px; vertical-align:-2px; }
.help-icon-btn { background:none; border:none; padding:0; color:#7a7a7a; cursor:pointer; display:flex; }
.help-icon-btn:hover { color:#e0e0e0; }
.help-tooltip { position:absolute; left:0; top:20px; width:220px; background:#242424; border:1px solid #3a3a3a; border-radius:8px; padding:10px 12px; font-size:11.5px; color:#c8c6bf; line-height:1.5; box-shadow:0 10px 30px #000000aa; z-index:50; }
.modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
.modal-actions .export-btn { border-radius:999px; padding:8px 18px; }
.modal-big-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:11px; margin:12px 0; border-radius:8px; background:#0d0d0d; border:1px solid #333; color:#fff; font-size:13px; font-weight:600; cursor:pointer; }
.modal-big-btn:hover { background:#000; border-color:#4a4a4a; }
.modal-big-btn.selected { background:#12305c; border-color:#2f8fef; color:#dbe9ff; }
.modal-big-btn-check { color:#2f8fef; }

.text-input, .num-input, textarea { cursor: text; user-select: text; -webkit-user-select: text; }
input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { filter: invert(1) brightness(1.7) contrast(0.75); opacity:0.65; cursor:pointer; }
input[type=number]::-webkit-inner-spin-button:hover, input[type=number]::-webkit-outer-spin-button:hover { opacity:1; }

.text-input:disabled, .num-input:disabled { cursor: default; }

.context-menu { position:fixed; background:#242424; border:1px solid #3a3a3a; border-radius:12px; min-width:210px; padding:5px; box-shadow:0 10px 30px #000000aa; z-index:200; }
.context-menu-header { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#7a7a7a; padding:6px 10px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.menu-dd-item.danger:hover:not(:disabled) { background:#e5484d; color:#fff; }

.guard-screen { flex:1; display:flex; align-items:center; justify-content:center; padding:32px; text-align:center; }
.guard-box { max-width:380px; }
.guard-icon { font-size:34px; margin-bottom:14px; }
.guard-title { font-size:16px; font-weight:700; color:#fff; margin-bottom:8px; }
.guard-body { font-size:13px; color:#a0a0a0; line-height:1.6; }

.gate-screen { flex:1; display:flex; align-items:center; justify-content:center; gap:64px; padding:40px; }
.gate-left { max-width:340px; }
.gate-title { font-size:26px; font-weight:700; color:#fff; margin-bottom:10px; }
.gate-sub { font-size:13.5px; color:#8a8a8a; line-height:1.6; }
.gate-sub code { color:#c8c6bf; background:#161616; padding:1px 4px; border-radius:3px; }
.gate-right { width:320px; flex-shrink:0; }
.gate-card { background:#202020; border:1px solid #333; border-radius:10px; padding:22px; display:flex; flex-direction:column; gap:12px; }
.gate-card-title { font-size:15px; font-weight:700; color:#fff; }
.gate-options-row { border-top:1px solid #2c2c2c; margin-top:2px; padding-top:12px; display:flex; flex-direction:column; gap:12px; }
.gate-options-label { display:flex; justify-content:space-between; align-items:center; font-size:10.5px; color:#8a8a8a; text-transform:uppercase; letter-spacing:.05em; }
.gate-reset-link { background:none; border:none; color:#4fa3ff; font-size:11px; cursor:pointer; text-transform:none; letter-spacing:normal; padding:0; }
.gate-reset-link:hover { color:#7cbaff; }
.gate-card-actions { display:flex; gap:8px; margin-top:4px; }
.gate-card-actions .gate-btn { flex:1; }
.gate-btn { padding:12px 18px; border-radius:8px; font-size:13.5px; font-weight:600; cursor:pointer; border:1px solid #333; background:#161616; color:#e6e6e6; }
.gate-btn:hover { border-color:#4a4a4a; background:#242424; }
.gate-btn.primary { background:#2f8fef; border-color:#2f8fef; color:#fff; }
.gate-btn.primary:hover { background:#4fa3ff; }
.save-status { margin-left:8px; font-size:10px; padding:2px 7px; border-radius:10px; background:#1c3a24; color:#66d19e; }
.save-status.dirty { background:#3a2a1c; color:#e0a53f; }
.new-badge { display:inline-block; margin-left:6px; padding:1px 6px; font-size:9px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#fff; background:#2f8fef; border-radius:4px; vertical-align:2px; }
.gate-browser-save { background:#161616; border:1px solid #333; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; margin-bottom: 4px; }
.gate-browser-save-info { display:flex; flex-direction:column; gap:2px; font-size:12px; color:#c8c6bf; }
.gate-browser-save-info span { font-size:10.5px; color:#7a7a7a; }
.gate-browser-save-actions { display:flex; gap:8px; }
.gate-browser-save-actions .gate-btn { flex:1; padding:7px; font-size:12px; }
.gate-divider { display:flex; align-items:center; gap:10px; color:#5c5d63; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
.gate-divider::before, .gate-divider::after { content:''; flex:1; height:1px; background:#333; }
.boot-screen { flex:1; display:flex; align-items:center; justify-content:center; }
.apple-spinner { position:relative; width:32px; height:32px; }
.apple-spinner-blade { position:absolute; top:0; left:50%; width:3px; height:9px; margin-left:-1.5px; background:#9a9a9a; border-radius:2px; transform-origin:1.5px 16px; animation: apple-blade-fade 1s linear infinite; }
@keyframes apple-blade-fade { 0% { opacity:1; } 100% { opacity:0.15; } }

.palette-overlay { position:fixed; inset:0; background:#000000aa; display:flex; align-items:flex-start; justify-content:center; padding-top:14vh; z-index:300; }
.palette-box { width:520px; max-width:90vw; background:#202020; border:1px solid #3a3a3a; border-radius:10px; box-shadow:0 24px 70px #000000cc; overflow:hidden; animation: paletteScaleIn 0.14s cubic-bezier(0.16,1,0.3,1); transform-origin:center; }
@keyframes paletteScaleIn { from { transform:scale(0.88); opacity:0; } to { transform:scale(1); opacity:1; } }
.palette-input-row { position:relative; border-bottom:1px solid #333; background:#161616; }
.palette-ghost { position:absolute; inset:0; padding:14px 16px; font-size:15px; white-space:pre; pointer-events:none; font-family:inherit; }
.ghost-typed { color:transparent; }
.ghost-suffix { color:#6d6d6d; }
.palette-input { position:relative; z-index:1; width:100%; background:transparent; border:none; color:#fff; font-size:15px; padding:14px 16px; outline:none; }
.palette-tab-badge { position:absolute; right:14px; top:50%; transform:translateY(-50%); z-index:1; font-size:10px; border:1px solid #444; border-radius:4px; padding:1px 5px; color:#8a8a8a; pointer-events:none; }
.palette-section-label { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:#6d6d6d; padding:8px 12px 4px; }
.palette-history-icon { color:#6d6d6d; transform:scaleX(-1); flex-shrink:0; }
.palette-results { scrollbar-width:thin; scrollbar-color:#3a3a3c #161616; }
.palette-results::-webkit-scrollbar { width:10px; }
.palette-results::-webkit-scrollbar-track { background:#161616; }
.palette-results::-webkit-scrollbar-thumb { background:#3a3a3c; border-radius:6px; border:2px solid #161616; }
.palette-results::-webkit-scrollbar-thumb:hover { background:#4d4d50; }
.palette-results { max-height:320px; overflow-y:auto; padding:6px; }
.palette-item { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; background:none; border:none; color:#e0e0e0; padding:9px 12px; font-size:13px; border-radius:6px; text-align:left; cursor:pointer; }
.palette-item.active, .palette-item:hover { background:#2f8fef; color:#fff; }
.palette-group { font-size:10.5px; color:#8a8a8a; text-transform:uppercase; letter-spacing:.04em; }
.palette-item.active .palette-group, .palette-item:hover .palette-group { color:#dbe9ff; }
.palette-empty { padding:16px; text-align:center; font-size:12.5px; color:#7a7a7a; }

@media (prefers-reduced-motion: reduce) { * { transition:none !important; } }

.embed-app { min-height: 0; height: 100%; }
.embed-app .embed-panel { width: 236px; flex-shrink: 0; background: #202020; display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #3a3a3c #161616; border-right: 1px solid #060606; }
.embed-footer { flex-shrink: 0; height: 20px; display: flex; align-items: center; justify-content: center; gap: 4px; background: #181818; border-top: 1px solid #060606; font-size: 10px; color: #8a8a8a; letter-spacing: .02em; }
.embed-footer b { color: #c9c9c9; font-weight: 600; }
.embed-footer-link { color: #d8d8d6; font-weight: 600; text-decoration: none; }
.embed-footer-link:hover { color: #ffffff; }

/* Compact density overrides for tight embed spaces */
.embed-app .panel-sub { display: none; }
.embed-app .parts-list { padding: 0 6px 6px; }
.embed-app .part-block { padding: 2px 0; }
.embed-app .part-head { gap: 6px; padding: 4px 3px; font-size: 11.5px; }
.embed-app .prop-list { padding: 1px 3px 3px; }
.embed-app .prop-row { height: 22px; gap: 4px; padding-left: 14px; }
.embed-app .prop-label { font-size: 10px; }
.embed-app .badge-chip { font-size: 8.5px; padding: 0 3px; }
.embed-app .prop-row .num-field { width: 50px; }
.embed-app .num-value, .embed-app .num-input { font-size: 11px; }
/* animation-only controls are meaningless without a timeline — hide for room
   (but keep the reset button: it resets the axis value to 0) */
.embed-app .stopwatch-btn, .embed-app .kf-nav-btn { display: none; }
.embed-app .viewport-hint { display: none; }
.embed-app .viewport-settings-btn, .embed-app .viewport-lock-btn { transform: scale(0.9); transform-origin: top left; }
.embed-test-log { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.55; white-space: pre-wrap; }
`;

/* ------------------------------------------------------------------ */
/*  Dockable panel zone (Premiere-style tab group)                    */
/* ------------------------------------------------------------------ */

function DockZone({
  zoneId, panelIds, activeId, onActivate, onDragStartTab, onDragOverZone,
  onDragLeaveZone, onDropTab, onDragEndTab, isDropTarget, isDraggingAnything, renderContent, horizontal,
}) {
  if (panelIds.length === 0) {
    if (!isDraggingAnything) return null;
    return (
      <div
        className={`dock-empty-strip${horizontal ? ' horizontal' : ''}${isDropTarget ? ' drop-target' : ''}`}
        onDragOver={(e) => { e.preventDefault(); onDragOverZone(zoneId); }}
        onDragLeave={() => onDragLeaveZone(zoneId)}
        onDrop={(e) => { e.preventDefault(); onDropTab(zoneId); }}
      >
        <span>Drop panel here</span>
      </div>
    );
  }
  return (
    <div className={`panel dock-panel${horizontal ? ' horizontal' : ''}${isDropTarget ? ' drop-target' : ''}`}>
      <div
        className="tab-strip"
        onDragOver={(e) => { e.preventDefault(); onDragOverZone(zoneId); }}
        onDragLeave={() => onDragLeaveZone(zoneId)}
        onDrop={(e) => { e.preventDefault(); onDropTab(zoneId); }}
      >
        {panelIds.map((id) => (
          <div
            key={id}
            className={`tab${id === activeId ? ' active' : ''}`}
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStartTab(id, zoneId); }}
            onDragEnd={onDragEndTab}
            onClick={() => onActivate(zoneId, id)}
            title="Drag to move this panel"
          >
            {PANEL_META[id].title}
          </div>
        ))}
        {isDropTarget && <div className="dock-drop-hint" />}
      </div>
      {renderContent(activeId)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Embed app — viewport + pose panel only, reports every pose change  */
/*  to the host page via window.parent.postMessage. Enabled with ?embed */
/* ------------------------------------------------------------------ */

export function EmbedApp() {
  const [steps, setSteps] = useState([zeroStep()]);
  const [selectedStep, setSelectedStep] = useState(0);
  const [expanded, setExpanded] = useState({ head: true, left_arm: true, right_arm: true, left_leg: true, right_leg: true });
  const [lockedParts, setLockedParts] = useState({});
  const [hiddenParts, setHiddenParts] = useState({});
  const [showGrid, setShowGrid] = useState(false);
  const [showShadows, setShowShadows] = useState(true);
  const [realisticModel, setRealisticModel] = useState(true);
  const [viewportLocked, setViewportLocked] = useState(false);
  const [viewportSettingsOpen, setViewportSettingsOpen] = useState(false);

  const viewportRef = useRef(null);
  useEffect(() => { viewportRef.current && viewportRef.current.setGridVisible(showGrid); }, [showGrid]);
  useEffect(() => { viewportRef.current && viewportRef.current.setShadowsEnabled(showShadows); }, [showShadows]);
  useEffect(() => { viewportRef.current && viewportRef.current.setRealisticModel(realisticModel); }, [realisticModel]);

  const pose = steps[selectedStep];
  const hiddenRef = useRef(hiddenParts);
  hiddenRef.current = hiddenParts;
  useEffect(() => {
    viewportRef.current && viewportRef.current.setPose(applyVisibility(pose, hiddenParts));
  }, [pose, hiddenParts]);

  // Live reporting: fires one message per single unit of change, so dragging
  // head.x from 10 -> 30 sends twenty {delta:+1} events as they happen.
  const prevPoseRef = useRef(null);
  useEffect(() => {
    const prev = prevPoseRef.current;
    prevPoseRef.current = JSON.parse(JSON.stringify(pose));
    if (!prev) return; // don't report the initial mount
    let reported = false;
    PARTS.forEach((part) => AXES.forEach((axis) => {
      const before = prev[part][axis];
      const after = pose[part][axis];
      if (before === after) return;
      reported = true;
      const stepDir = Math.sign(after - before) || 1;
      for (let v = before + stepDir; stepDir > 0 ? v <= after : v >= after; v += stepDir) {
        try {
          window.parent.postMessage({
            type: 'aas-pose-change',
            source: 'advanced-armor-stands',
            part, axis,
            delta: stepDir,
            value: round1(v),
            total: round1(after),
          }, '*');
        } catch { /* parent may be same-origin-less (file://); ignore */ }
      }
    }));
    if (reported) {
      try {
        window.parent.postMessage({
          type: 'aas-pose', source: 'advanced-armor-stands',
          pose: JSON.parse(JSON.stringify(pose)),
          selectedStep,
        }, '*');
      } catch { /* ignore */ }
    }
  }, [pose, selectedStep]);

  function onChangeAxis(part, axis, value) {
    setSteps((s) => {
      const next = [...s];
      next[selectedStep] = { ...next[selectedStep], [part]: { ...next[selectedStep][part], [axis]: value } };
      return next;
    });
  }
  const toggleExpanded = (part) => setExpanded((e) => ({ ...e, [part]: !e[part] }));
  const toggleLocked = (part) => setLockedParts((p) => ({ ...p, [part]: !p[part] }));
  const toggleHidden = (part) => setHiddenParts((p) => ({ ...p, [part]: !p[part] }));
  function noopHistory() {}

  return (
    <div className="aas-app embed-app">
      <style>{CSS}</style>

      <div className="body-row">
        <div className="panel parts-panel embed-panel">
          <PartsPanel
            stepIndex={selectedStep}
            steps={steps}
            pose={pose}
            onChangeAxis={onChangeAxis}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            lockedParts={lockedParts}
            hiddenParts={hiddenParts}
            onDragStart={noopHistory}
            onFlattenAxis={noopHistory}
            onJumpChange={noopHistory}
            onResetAxis={(part, axis) => onChangeAxis(part, axis, 0)}
            onValueContextMenu={() => {}}
            partOrder={[...PARTS]}
          />
        </div>

        <div className="viewport-panel">
          <div className="viewport-wrap" onContextMenu={(e) => e.preventDefault()}>
            <Viewport ref={viewportRef} initialShowGrid={showGrid} initialShowShadows={showShadows} initialRealistic={realisticModel} locked={viewportLocked} />
            <div className="viewport-settings">
              <button type="button" className="viewport-settings-btn" onClick={() => setViewportSettingsOpen((o) => !o)} title="Viewport settings">
                <Settings2 size={15} />
              </button>
              {viewportSettingsOpen && (
                <div className="viewport-settings-menu">
                  <button type="button" className="menu-dd-item" onClick={() => setShowGrid((g) => !g)}>
                    <span><Grid3x3 size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Grid</span>
                    <span>{showGrid ? 'On' : 'Off'}</span>
                  </button>
                  <button type="button" className="menu-dd-item" onClick={() => setShowShadows((v) => !v)}>
                    <span><Sun size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Shadows</span>
                    <span>{showShadows ? 'On' : 'Off'}</span>
                  </button>
                  <button type="button" className="menu-dd-item" onClick={() => setRealisticModel((v) => !v)}>
                    <span><Box size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Minecraft model</span>
                    <span>{realisticModel ? 'On' : 'Off'}</span>
                  </button>
                </div>
              )}
            </div>
            <div className="viewport-hint">drag to orbit · scroll to zoom</div>
            <button
              type="button"
              className="viewport-lock-btn"
              onClick={() => setViewportLocked((l) => !l)}
              title={viewportLocked ? 'Unlock camera' : 'Lock camera'}
            >
              {viewportLocked ? <Lock size={15} /> : <Unlock size={15} />}
            </button>
          </div>
        </div>
      </div>

      <div className="embed-footer">
        Powered by{' '}
        <a
          className="embed-footer-link"
          href="https://animate.advancedarmrostands.ir"
          target="_blank"
          rel="noopener noreferrer"
        >
          AdvancedArmorStands
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [appReady, setAppReady] = useState(false);
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
    const finish = () => setAppReady(true);
    link.onload = finish;
    link.onerror = finish;
    document.head.appendChild(link);
    const fallback = setTimeout(finish, 1400);
    return () => { document.head.removeChild(link); clearTimeout(fallback); };
  }, []);
  const [animName, setAnimName] = useState('unnamed');
  const [interval, setInterval] = useState(10);
  const [loop, setLoop] = useState(true);
  const [realisticEnabled, setRealisticEnabled] = useState(false);
  const [realisticFrames, setRealisticFrames] = useState(4);
  const [steps, setSteps] = useState([zeroStep()]);
  const [selectedStep, setSelectedStep] = useState(0);
  const [expanded, setExpanded] = useState({
    head: true, left_arm: true, right_arm: true, left_leg: false, right_leg: false,
  });
  const [lockedParts, setLockedParts] = useState({});
  const [partOrder, setPartOrder] = useState(() => {
    try {
      const raw = localStorage.getItem('aas-part-order');
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length === PARTS.length && PARTS.every((p) => parsed.includes(p))) return parsed;
    } catch { /* ignore */ }
    return [...PARTS];
  });
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem('aas-part-order', JSON.stringify(partOrder)); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(id);
  }, [partOrder]);
  const [hiddenParts, setHiddenParts] = useState({});
  const [selectedDots, setSelectedDots] = useState(() => new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(() => {
    try {
      const n = parseFloat(localStorage.getItem('aas-timeline-zoom'), 10);
      if (!Number.isNaN(n) && n >= 0.5 && n <= 2.5) return round1(n);
    } catch { /* ignore */ }
    return 1;
  });
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem('aas-timeline-zoom', String(zoom)); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(id);
  }, [zoom]);
  const [copyStatus, setCopyStatus] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [activeTab, setActiveTab] = useState(DEFAULT_ACTIVE_TAB);
  const [dragPanel, setDragPanel] = useState(null);
  const [dropZone, setDropZone] = useState(null);
  const [showGrid, setShowGrid] = useState(false);
  const [showShadows, setShowShadows] = useState(true);
  const [realisticModel, setRealisticModel] = useState(true);
  const [viewportLocked, setViewportLocked] = useState(false);
  const [viewportSettingsOpen, setViewportSettingsOpen] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    try {
      const n = parseFloat(localStorage.getItem('aas-timeline-height'), 10);
      if (!Number.isNaN(n) && n >= 120 && n <= 900) return Math.round(n);
    } catch { /* ignore */ }
    return 360;
  });
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem('aas-timeline-height', String(timelineHeight)); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(id);
  }, [timelineHeight]);
  const [workspace, setWorkspace] = useState('animate');
  const [openMenu, setOpenMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [savePreference, setSavePreference] = useState(null);
  const [browserSave, setBrowserSave] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  function currentAnimSnapshot() {
    return JSON.stringify({ animName, interval, loop, realisticEnabled, realisticFrames, steps });
  }
  const [saveBrowserStatus, setSaveBrowserStatus] = useState('');
  function refreshBrowserSave() {
    try {
      const raw = localStorage.getItem('aas-saved-project');
      setBrowserSave(raw ? JSON.parse(raw) : null);
    } catch { setBrowserSave(null); }
  }
  function saveProjectToBrowser() {
    try {
      const payload = JSON.stringify({ animName, interval, loop, realisticEnabled, realisticFrames, steps, savedAt: Date.now() });
      localStorage.setItem('aas-saved-project', payload);
      setSavedSnapshot(currentAnimSnapshot());
      setSaveBrowserStatus('Saved to browser');
    } catch { setSaveBrowserStatus('Not available in this browser'); }
    setTimeout(() => setSaveBrowserStatus(''), 2500);
  }
  function importFromBrowser() {
    if (!browserSave) return;
    setAnimName(browserSave.animName);
    setInterval(browserSave.interval);
    setLoop(browserSave.loop);
    setRealisticEnabled(!!browserSave.realisticEnabled);
    setRealisticFrames(browserSave.realisticFrames || 1);
    setSteps(browserSave.steps);
    setSelectedStep(0);
    setHistory([]);
    setFuture([]);
    setLayout(DEFAULT_LAYOUT);
    setActiveTab(DEFAULT_ACTIVE_TAB);
    setWorkspace('animate');
    setProjectOpen(true);
  }
  function deleteBrowserSave() {
    try { localStorage.removeItem('aas-saved-project'); } catch { /* ignore */ }
    setBrowserSave(null);
  }
  const [gateMode, setGateMode] = useState('choice');
  const [gateName, setGateName] = useState('');
  const [gateInterval, setGateInterval] = useState(10);
  const [gateLoop, setGateLoop] = useState(true);
  const [gateRealistic, setGateRealistic] = useState(false);
  const [gateFrames, setGateFrames] = useState(4);
  const [gateImportText, setGateImportText] = useState('');
  const [gateImportPick, setGateImportPick] = useState('');
  const [gateError, setGateError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteHistory, setPaletteHistory] = useState([]);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [clipboardPose, setClipboardPose] = useState(null);
  const [clipboardValue, setClipboardValue] = useState(null);
  const [viewportSize, setViewportSize] = useState(() => (
    typeof window === 'undefined' ? { w: 1200, h: 800 } : { w: window.innerWidth, h: window.innerHeight }
  ));

  useEffect(() => {
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const isMobileDevice = typeof navigator !== 'undefined'
    && /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isMobile = isMobileDevice || (viewportSize.w < 620 && typeof window !== 'undefined' && 'ontouchstart' in window);
  const isTooSmall = !isMobile && (viewportSize.w < 980 || viewportSize.h < 560);

  const viewportRef = useRef(null);
  const scrollAreaRef = useRef(null);
  useEffect(() => {
    if (!projectOpen) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Reloading will lose everything in this project — are you sure?';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [projectOpen]);
  useEffect(() => { viewportRef.current && viewportRef.current.setGridVisible(showGrid); }, [showGrid]);
  useEffect(() => { viewportRef.current && viewportRef.current.setShadowsEnabled(showShadows); }, [showShadows]);
  useEffect(() => { viewportRef.current && viewportRef.current.setRealisticModel(realisticModel); }, [realisticModel]);
  const playheadRef = useRef(null);
  const rafRef = useRef(null);

  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  const intervalRef = useRef(interval);
  useEffect(() => { intervalRef.current = interval; }, [interval]);
  const loopRef = useRef(loop);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  const hiddenRef = useRef(hiddenParts);
  useEffect(() => { hiddenRef.current = hiddenParts; }, [hiddenParts]);
  const animNameRef = useRef(animName);
  useEffect(() => { animNameRef.current = animName; }, [animName]);
  const selectedStepRef = useRef(selectedStep);
  useEffect(() => { selectedStepRef.current = selectedStep; }, [selectedStep]);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // Exact fractional playhead position (e.g. 3.42 = 42% between step 3 and 4).
  // Kept in sync with selectedStep whenever the user scrubs/jumps while paused,
  // so resuming Play always continues from exactly where it left off.
  const playPositionRef = useRef(selectedStep);
  useEffect(() => {
    if (!isPlayingRef.current) playPositionRef.current = selectedStep;
  }, [selectedStep]);

  const stepWidth = 64 * zoom;
  const scrubFillRef = useRef(null);
  const scrubMarkerRef = useRef(null);
  const scrubTimeRef = useRef(null);
  const scrollPlayheadIntoView = (px) => {
    const el = scrollAreaRef.current;
    if (!el) return;
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, px - 20);
    }
  };
  const updateScrub = (position) => {
    const total = stepsRef.current.length;
    const pct = total > 1 ? Math.min(1, Math.max(0, position / (total - 1))) : 0;
    if (scrubFillRef.current) scrubFillRef.current.style.width = `${pct * 100}%`;
    if (scrubMarkerRef.current) scrubMarkerRef.current.style.left = `${pct * 100}%`;
    if (scrubTimeRef.current) {
      const ms = position * Math.max(intervalRef.current, 1) * 50;
      scrubTimeRef.current.textContent = formatTime(ms);
    }
  };

  useEffect(() => {
    if (isPlaying) return;
    const pose = getPoseAtPosition(steps, playPositionRef.current);
    if (pose && viewportRef.current) viewportRef.current.setPose(applyVisibility(pose, hiddenParts));
    updateScrub(playPositionRef.current);
    scrollPlayheadIntoView(playPositionRef.current * stepWidth + stepWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, selectedStep, isPlaying, hiddenParts]);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      return undefined;
    }
    let position = playPositionRef.current;
    let lastTime = null;
    let lastIdx = Math.floor(position);

    function frame(now) {
      const total = stepsRef.current.length;
      if (lastTime === null || total < 2) {
        // First callback (or nothing to animate yet) just sets the clock baseline — no jump.
        lastTime = now;
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      const stepMs = Math.max(intervalRef.current, 1) * 50;
      // Clamp the per-frame delta so a delayed/late frame (e.g. right after a drag,
      // or a throttled/backgrounded tab) can never cause a big one-frame jump.
      const dt = Math.min(now - lastTime, 250);
      lastTime = now;
      position += dt / stepMs;

      if (!loopRef.current && position >= total - 1) {
        const lastStep = total - 1;
        playPositionRef.current = lastStep;
        if (viewportRef.current) viewportRef.current.setPose(applyVisibility(stepsRef.current[lastStep], hiddenRef.current));
        if (playheadRef.current) playheadRef.current.style.left = `${lastStep * stepWidth + stepWidth / 2}px`;
        scrollPlayheadIntoView(lastStep * stepWidth + stepWidth / 2);
        updateScrub(lastStep);
        setSelectedStep(lastStep);
        setIsPlaying(false);
        return;
      }
      const effectivePosition = loopRef.current
        ? ((position % total) + total) % total
        : position;
      position = effectivePosition;
      const curIdx = Math.min(total - 1, Math.floor(effectivePosition));
      const t = effectivePosition - curIdx;
      const nextIdx = (curIdx + 1) % total;
      playPositionRef.current = effectivePosition;
      const pose = applyVisibility(lerpPose(stepsRef.current[curIdx], stepsRef.current[nextIdx], t), hiddenRef.current);
      if (viewportRef.current) viewportRef.current.setPose(pose);
      const px = effectivePosition * stepWidth + stepWidth / 2;
      if (playheadRef.current) playheadRef.current.style.left = `${px}px`;
      scrollPlayheadIntoView(px);
      updateScrub(effectivePosition);
      if (curIdx !== lastIdx) {
        lastIdx = curIdx;
        setSelectedStep(curIdx);
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  /* ---------------- undo / redo ---------------- */

  function snapshot() {
    const snap = {
      steps: cloneSteps(stepsRef.current),
      animName: animNameRef.current,
      interval: intervalRef.current,
      loop: loopRef.current,
      realisticEnabled,
      realisticFrames,
    };
    setHistory((h) => [...h.slice(-49), snap]);
    setFuture([]);
  }
  function applySnapshot(snap) {
    setSteps(snap.steps);
    setAnimName(snap.animName);
    setInterval(snap.interval);
    setLoop(snap.loop);
    if (snap.realisticEnabled !== undefined) setRealisticEnabled(snap.realisticEnabled);
    if (snap.realisticFrames !== undefined) setRealisticFrames(snap.realisticFrames);
    setSelectedStep((i) => Math.min(i, snap.steps.length - 1));
  }

  /* ---------------- project manager (start gate) ---------------- */

  function handleSaveShortcut() {
    if (savePreference === 'export') { downloadYaml(); return; }
    if (savePreference === 'browser') { saveProjectToBrowser(); return; }
    setModal({
      kind: 'save',
      title: 'Save your work?',
      message: "This tool can't save automatically, you can do one of these:",
      showCheckbox: true,
      checkboxLabel: 'Do one of these every time instead of asking',
      onExport: (checked) => {
        if (checked) setSavePreference('export');
        downloadYaml();
      },
      onSaveBrowser: (checked) => {
        if (checked) setSavePreference('browser');
        saveProjectToBrowser();
      },
    });
  }
  function resetGateOptions() {
    setGateInterval(10);
    setGateLoop(true);
    setGateRealistic(false);
    setGateFrames(4);
  }
  function createProject() {
    const clean = gateName.trim().replace(/\s+/g, '_') || 'unnamed';
    setAnimName(clean);
    setInterval(gateInterval);
    setLoop(gateLoop);
    setRealisticEnabled(gateRealistic);
    setRealisticFrames(gateFrames);
    setSteps([zeroStep()]);
    setSelectedStep(0);
    setHistory([]);
    setFuture([]);
    setLayout(DEFAULT_LAYOUT);
    setActiveTab(DEFAULT_ACTIVE_TAB);
    setWorkspace('animate');
    setProjectOpen(true);
  }
  const gateImportNames = listAnimationNames(gateImportText);
  useEffect(() => { if (gateMode === 'import') refreshBrowserSave(); }, [gateMode]); // eslint-disable-line react-hooks/exhaustive-deps
  function importProjectFromGate() {
    const parsed = parseAnimationYaml(gateImportText, gateImportPick);
    if (!parsed) {
      setGateError("Couldn't find a valid animation in that text — needs a name, interval, loop and steps.");
      return;
    }
    setAnimName(parsed.name);
    setInterval(parsed.interval);
    setLoop(parsed.loop);
    setRealisticEnabled(parsed.realisticEnabled);
    setRealisticFrames(parsed.realisticFrames);
    setSteps(parsed.steps);
    setSelectedStep(0);
    setHistory([]);
    setFuture([]);
    setLayout(DEFAULT_LAYOUT);
    setActiveTab(DEFAULT_ACTIVE_TAB);
    setWorkspace('animate');
    setWorkspace('animate');
    setProjectOpen(true);
  }

  function undo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setFuture((f) => [...f, {
      steps: cloneSteps(stepsRef.current), animName: animNameRef.current, interval: intervalRef.current, loop: loopRef.current,
    }]);
    applySnapshot(prev);
  }
  function redo() {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setHistory((h) => [...h, {
      steps: cloneSteps(stepsRef.current), animName: animNameRef.current, interval: intervalRef.current, loop: loopRef.current,
    }]);
    applySnapshot(next);
  }

  /* ---------------- core actions ---------------- */

  const togglePlay = () => setIsPlaying((p) => {
    const next = !p;
    if (next && !loopRef.current && playPositionRef.current >= stepsRef.current.length - 1) {
      playPositionRef.current = 0;
      setSelectedStep(0);
    }
    return next;
  });
  const restart = () => { setIsPlaying(false); setSelectedStep(0); };
  const jumpToEnd = () => { setIsPlaying(false); setSelectedStep(steps.length - 1); };
  const stepBack = () => { setIsPlaying(false); setSelectedStep((i) => Math.max(0, i - 1)); };
  const stepFwd = () => { setIsPlaying(false); setSelectedStep((i) => Math.min(steps.length - 1, i + 1)); };
  const toggleLoop = () => { snapshot(); setLoop((l) => !l); };

  const addStepAt = (afterIdx, poseOverride) => {
    snapshot();
    setSteps((prev) => {
      const source = poseOverride ?? prev[afterIdx] ?? prev[prev.length - 1];
      const clone = JSON.parse(JSON.stringify(source));
      return [...prev.slice(0, afterIdx + 1), clone, ...prev.slice(afterIdx + 1)];
    });
    setSelectedStep(afterIdx + 1);
  };
  const addStep = () => addStepAt(selectedStepRef.current);
  const duplicateStep = (idx) => {
    snapshot();
    setSteps((prev) => {
      const clone = JSON.parse(JSON.stringify(prev[idx]));
      return [...prev.slice(0, idx + 1), clone, ...prev.slice(idx + 1)];
    });
    setSelectedStep(idx + 1);
  };
  const deleteStep = (idx) => {
    if (stepsRef.current.length <= 1) return;
    snapshot();
    setSteps((prev) => prev.filter((_, i) => i !== idx));
    setSelectedStep(Math.max(0, idx - 1));
  };
  const resetPoseAt = (idx) => {
    snapshot();
    setSteps((prev) => prev.map((s, i) => (i !== idx ? s : zeroStep())));
  };
  const resetPose = () => resetPoseAt(selectedStepRef.current);
  const moveStep = (fromIdx, toIdx, copy) => {
    snapshot();
    setSteps((prev) => {
      const next = [...prev];
      if (copy) {
        const dup = cloneSteps([prev[fromIdx]])[0];
        const at = Math.max(0, Math.min(next.length, toIdx));
        next.splice(at, 0, dup);
      } else {
        const [item] = next.splice(fromIdx, 1);
        const at = Math.max(0, Math.min(next.length, toIdx));
        next.splice(at, 0, item);
      }
      return next;
    });
    setSelectedStep(Math.max(0, Math.min(toIdx, copy ? stepsRef.current.length : stepsRef.current.length - 1)));
  };

  // Marquee-selected keyframes: whole steps (every part selected) get deleted,
  // steps with only some parts selected have just those parts reset to 0.
  const deleteOrResetSelection = () => {
    if (selectedDots.size === 0) {
      deleteStep(selectedStepRef.current);
      return;
    }
    const byStep = {};
    selectedDots.forEach((key) => {
      const sep = key.lastIndexOf('-');
      const part = key.slice(0, sep);
      const idx = parseInt(key.slice(sep + 1), 10);
      if (!byStep[idx]) byStep[idx] = new Set();
      byStep[idx].add(part);
    });
    const wholeSteps = [];
    const partialEntries = [];
    Object.keys(byStep).forEach((k) => {
      const idx = parseInt(k, 10);
      const partsSet = byStep[idx];
      if (partsSet.size >= PARTS.length) wholeSteps.push(idx);
      else partsSet.forEach((part) => partialEntries.push({ idx, part }));
    });
    const total = stepsRef.current.length;
    const newLength = wholeSteps.length > 0 ? Math.max(1, total - wholeSteps.length) : total;

    snapshot();
    setSteps((prev) => {
      let next = prev.map((s, i) => {
        const entries = partialEntries.filter((e) => e.idx === i);
        if (entries.length === 0) return s;
        const copy = { ...s };
        entries.forEach(({ part }) => { copy[part] = { x: 0, y: 0, z: 0 }; });
        return copy;
      });
      if (wholeSteps.length > 0) {
        const toDelete = new Set(wholeSteps);
        const remaining = next.filter((_, i) => !toDelete.has(i));
        next = remaining.length > 0 ? remaining : next;
      }
      return next;
    });
    setSelectedDots(new Set());
    setSelectedStep((i) => Math.max(0, Math.min(i, newLength - 1)));
  };

  const updateAxis = (part, axis, value) => {
    if (lockedParts[part]) return;
    const clamped = Math.max(-180, Math.min(180, value));
    setSteps((prev) => prev.map((s, i) => (
      i !== selectedStepRef.current ? s : { ...s, [part]: { ...s[part], [axis]: clamped } }
    )));
  };
  const toggleExpanded = (part) => setExpanded((e) => ({ ...e, [part]: !e[part] }));

  /* ---------------- context menu ---------------- */

  const closeContextMenu = () => setContextMenu(null);
  const openContextMenu = (x, y, items) => setContextMenu({ x, y, items });

  const openDotMenu = (e, part, idx) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, [
      { header: true, label: `Step ${idx + 1} · ${PART_META[part].label}` },
      { divider: true },
      { label: 'Select step', action: () => { setIsPlaying(false); setSelectedStep(idx); } },
      { label: 'Copy step pose', action: () => setClipboardPose(cloneSteps([stepsRef.current[idx]])[0]) },
      { label: 'Paste pose here', disabled: !clipboardPose, action: () => { snapshot(); setSteps((prev) => prev.map((s, i) => (i !== idx ? s : cloneSteps([clipboardPose])[0]))); } },
      { divider: true },
      { label: 'Duplicate step', shortcut: 'Ctrl/⌘ D', action: () => duplicateStep(idx) },
      { label: "Reset this step's pose", action: () => resetPoseAt(idx) },
      { label: 'Delete step', shortcut: 'Del', disabled: stepsRef.current.length <= 1, danger: true, action: () => deleteStep(idx) },
    ]);
  };
  const openTimelineMenu = (e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, [
      { header: true, label: `Tick ${idx * intervalRef.current}` },
      { divider: true },
      { label: 'Add step here', action: () => addStepAt(idx) },
      { label: 'Paste pose as new step', disabled: !clipboardPose, action: () => addStepAt(idx, clipboardPose) },
    ]);
  };
  const openValueMenu = (e, part, axis) => {
    e.preventDefault();
    e.stopPropagation();
    const val = stepsRef.current[selectedStepRef.current][part][axis];
    openContextMenu(e.clientX, e.clientY, [
      { header: true, label: `${PART_META[part].label} ${axis.toUpperCase()}` },
      { divider: true },
      { label: 'Copy value', action: () => setClipboardValue(val) },
      { label: 'Paste value', disabled: clipboardValue === null, action: () => { snapshot(); updateAxis(part, axis, clipboardValue); } },
      { label: 'Reset to 0', action: () => resetAxis(part, axis) },
      { label: 'Make constant across all steps', action: () => flattenAxis(part, axis) },
    ]);
  };
  const openViewportMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Reset camera', action: () => viewportRef.current && viewportRef.current.resetView() },
      { label: isPlaying ? 'Pause' : 'Play', action: togglePlay },
      { divider: true },
      { label: (showLeft || showRight) ? 'Focus viewport' : 'Show panels', action: toggleFocus },
    ]);
  };
  const openDefaultMenu = (e) => {
    e.preventDefault();
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const el = e.target;
      openContextMenu(e.clientX, e.clientY, [
        { label: 'Cut', shortcut: 'Ctrl/⌘ X', disabled: el.selectionStart === el.selectionEnd, action: () => document.execCommand('cut') },
        { label: 'Copy', shortcut: 'Ctrl/⌘ C', disabled: el.selectionStart === el.selectionEnd, action: () => document.execCommand('copy') },
        { label: 'Paste', shortcut: 'Ctrl/⌘ V', action: () => document.execCommand('paste') },
      ]);
      return;
    }
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Undo', disabled: history.length === 0, action: undo },
      { label: 'Redo', disabled: future.length === 0, action: redo },
    ]);
  };
  const toggleLocked = (part) => setLockedParts((s) => ({ ...s, [part]: !s[part] }));
  const toggleHidden = (part) => setHiddenParts((s) => ({ ...s, [part]: !s[part] }));

  const jumpToChange = (part, axis, dir) => {
    const cur = selectedStepRef.current;
    const curVal = stepsRef.current[cur][part][axis];
    setIsPlaying(false);
    if (dir < 0) {
      for (let i = cur - 1; i >= 0; i -= 1) {
        if (stepsRef.current[i][part][axis] !== curVal) { setSelectedStep(i); return; }
      }
    } else {
      for (let i = cur + 1; i < stepsRef.current.length; i += 1) {
        if (stepsRef.current[i][part][axis] !== curVal) { setSelectedStep(i); return; }
      }
    }
  };
  const resetAxis = (part, axis) => {
    if (lockedParts[part]) return;
    snapshot();
    setSteps((prev) => prev.map((s, i) => (
      i !== selectedStepRef.current ? s : { ...s, [part]: { ...s[part], [axis]: 0 } }
    )));
  };
  const flattenAxis = (part, axis) => {
    const val = stepsRef.current[selectedStepRef.current][part][axis];
    setModal({
      kind: 'confirm',
      title: 'Make property constant',
      message: `Set ${PART_META[part].label} ${axis.toUpperCase()} to ${round1(val)} on all ${stepsRef.current.length} steps? This removes its animation.`,
      confirmLabel: 'Flatten',
      onConfirm: () => {
        snapshot();
        setSteps((prev) => prev.map((s) => ({ ...s, [part]: { ...s[part], [axis]: val } })));
      },
    });
  };

  function buildAnimationLines() {
    const lines = [];
    const name = animName.trim() || 'unnamed';
    lines.push(`  ${name}:`);
    lines.push(`    interval: ${interval}`);
    lines.push(`    loop: ${loop}`);
    lines.push('    realistic-animations:');
    lines.push(`      enabled: ${realisticEnabled}`);
    lines.push(`      frames: ${realisticFrames}`);
    lines.push('    steps:');
    steps.forEach((step) => {
      PARTS.forEach((part, idx) => {
        const prefix = idx === 0 ? '      - ' : '        ';
        lines.push(`${prefix}${part}:`);
        const p = step[part];
        lines.push(`          x: ${round1(p.x)}`);
        lines.push(`          y: ${round1(p.y)}`);
        lines.push(`          z: ${round1(p.z)}`);
      });
    });
    return lines;
  }
  const snippetYaml = useMemo(
    () => buildAnimationLines().join('\n'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animName, interval, loop, realisticEnabled, realisticFrames, steps],
  );
  const fullYaml = useMemo(() => `animations:\n${snippetYaml}\n`, [snippetYaml]);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippetYaml);
      setCopyStatus('Copied to clipboard!');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = snippetYaml;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopyStatus('Copied to clipboard!');
      } catch {
        setCopyStatus('Copy failed — select the text in the Preview tab.');
      }
    }
    setTimeout(() => setCopyStatus(''), 2500);
  }
  function downloadYaml() {
    try {
      const blob = new Blob([fullYaml], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'animations.yml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadStatus('Downloaded animations.yml');
    } catch {
      setDownloadStatus('Download failed — copy the text instead.');
    }
    setTimeout(() => setDownloadStatus(''), 2500);
  }

  /* ---------------- workspaces ---------------- */

  function goWorkspace(name) {
    setWorkspace(name);
    if (name === 'animate') { setIsPlaying(false); setShowLeft(true); setShowRight(true); }
  }
  function toggleFocus() {
    if (showLeft || showRight) { setShowLeft(false); setShowRight(false); } else { setShowLeft(true); setShowRight(true); }
  }

  /* ---------------- dockable panels (drag & drop) ---------------- */

  function onDragStartTab(id, fromZone) {
    setDragPanel({ id, fromZone });
  }
  function onDragOverZone(zoneId) {
    setDropZone(zoneId);
  }
  function onDragLeaveZone(zoneId) {
    setDropZone((z) => (z === zoneId ? null : z));
  }
  function onDropTab(zoneId) {
    if (!dragPanel) return;
    const { id, fromZone } = dragPanel;
    if (fromZone !== zoneId) {
      const next = {
        left: layout.left.filter((p) => p !== id),
        right: layout.right.filter((p) => p !== id),
        bottom: layout.bottom.filter((p) => p !== id),
      };
      next[zoneId] = [...next[zoneId], id];
      setLayout(next);
      setActiveTab((prev) => {
        const updated = { ...prev, [zoneId]: id };
        if (prev[fromZone] === id) updated[fromZone] = next[fromZone][0];
        return updated;
      });
      setShowLeft(true);
      setShowRight(true);
    }
    setDragPanel(null);
    setDropZone(null);
  }
  function onDragEndTab() {
    setDragPanel(null);
    setDropZone(null);
  }
  function resetLayout() {
    setLayout(DEFAULT_LAYOUT);
    setActiveTab(DEFAULT_ACTIVE_TAB);
    setShowLeft(true);
    setShowRight(true);
  }
  function renderPanelContent(id) {
    if (id === 'pose') {
      return (
        <PartsPanel
          stepIndex={selectedStep}
          steps={steps}
          pose={steps[selectedStep]}
          onChangeAxis={updateAxis}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
          lockedParts={lockedParts}
          hiddenParts={hiddenParts}
          onDragStart={snapshot}
          onFlattenAxis={flattenAxis}
          onJumpChange={jumpToChange}
          onResetAxis={resetAxis}
          onValueContextMenu={openValueMenu}
        partOrder={partOrder}
        />
      );
    }
    if (id === 'settings') {
      return (
        <SettingsPanel
          animName={animName}
          setAnimName={setAnimName}
          interval={interval}
          setInterval={setInterval}
          loop={loop}
          setLoop={setLoop}
          realisticEnabled={realisticEnabled}
          setRealisticEnabled={setRealisticEnabled}
          realisticFrames={realisticFrames}
          setRealisticFrames={setRealisticFrames}
          steps={steps}
          onFieldFocus={snapshot}
        />
      );
    }
    return null;
  }

  /* ---------------- menu actions ---------------- */

  const menus = {
    File: [
      { action: 'import', label: 'Import animations.yml…' },
      { divider: true },
      { action: 'copy', label: 'Copy animation block', shortcut: '' },
      { action: 'download', label: 'Download animations.yml', shortcut: 'Ctrl/⌘ S' },
      { divider: true },
      { action: 'new', label: 'New animation…' },
      { action: 'backToProjects', label: 'Back to Project Selector…' },
      { action: 'changeSavePreference', label: 'Change save preference…' },
    ],
    Edit: [
      { action: 'undo', label: 'Undo', shortcut: 'Ctrl/⌘ Z', disabledKey: 'canUndo' },
      { action: 'redo', label: 'Redo', shortcut: 'Ctrl/⌘ ⇧Z', disabledKey: 'canRedo' },
      { divider: true },
      { action: 'resetPose', label: 'Reset this step\u2019s pose' },
    ],
    Step: [
      { action: 'addStep', label: 'Add step' },
      { action: 'duplicateStep', label: 'Duplicate step', shortcut: 'Ctrl/⌘ D' },
      { action: 'deleteStep', label: 'Delete step', disabledKey: 'canDeleteStep', shortcut: 'Del' },
      { divider: true },
      { action: 'stepBack', label: 'Previous step', shortcut: '←' },
      { action: 'stepFwd', label: 'Next step', shortcut: '→' },
    ],
    Animation: [
      { action: 'togglePlay', label: isPlaying ? 'Pause' : 'Play', shortcut: 'Space' },
      { action: 'restart', label: 'Go to start', shortcut: 'Home' },
      { action: 'jumpToEnd', label: 'Go to end', shortcut: 'End' },
      { divider: true },
      { action: 'toggleLoop', label: loop ? 'Disable loop' : 'Enable loop', shortcut: 'L' },
      { action: 'rename', label: 'Rename animation…' },
      { action: 'setInterval', label: 'Set interval…' },
    ],
    View: [
      { action: 'zoomIn', label: 'Zoom in timeline', shortcut: '+' },
      { action: 'zoomOut', label: 'Zoom out timeline', shortcut: '-' },
      { action: 'resetCamera', label: 'Reset 3D camera' },
      { action: 'toggleGrid', label: showGrid ? 'Hide grid' : 'Show grid', shortcut: 'G' },
      { divider: true },
      { action: 'toggleFocus', label: (showLeft || showRight) ? 'Focus viewport' : 'Show panels' },
    ],
    Window: [
      { action: 'workspaceAnimate', label: 'Animate' },
      { action: 'workspaceExport', label: 'Export' },
      { divider: true },
      { action: 'togglePoseInspector', label: showLeft ? 'Hide left panel' : 'Show left panel' },
      { action: 'toggleSettingsPanel', label: showRight ? 'Hide right panel' : 'Show right panel' },
      { divider: true },
      { action: 'resetLayout', label: 'Reset panel layout' },
    ],
    Help: [
      { action: 'openDocs', label: 'Plugin documentation' },
      { action: 'shortcuts', label: 'Keyboard shortcuts' },
      { action: 'about', label: 'About AS Animator' },
    ],
  };

  function runMenuAction(action) {
    switch (action) {
      case 'import':
        setModal({
          kind: 'import',
          title: 'Import animation',
          onImport: (parsed) => {
            snapshot();
            setAnimName(parsed.name);
            setInterval(parsed.interval);
            setLoop(parsed.loop);
            setRealisticEnabled(parsed.realisticEnabled);
            setRealisticFrames(parsed.realisticFrames);
            setSteps(parsed.steps);
            setSelectedStep(0);
          },
        });
        break;
      case 'copy': copySnippet(); break;
      case 'download': downloadYaml(); break;
      case 'new':
        setModal({
          kind: 'confirm',
          title: 'New animation',
          message: 'This clears every step in the current animation. This can be undone with Edit \u2192 Undo.',
          confirmLabel: 'New animation',
          onConfirm: () => {
            snapshot();
            setAnimName('unnamed');
            setInterval(10);
            setLoop(true);
            setRealisticEnabled(false);
            setRealisticFrames(4);
            setSteps([zeroStep()]);
            setSelectedStep(0);
          },
        });
        break;
      case 'changeSavePreference':
        setModal({
          kind: 'save',
          title: 'Change save preference',
          message: 'Choose which one Ctrl/⌘ S should do automatically — click one to select it:',
          selectMode: true,
          onExport: () => setSavePreference((p) => (p === 'export' ? null : 'export')),
          onSaveBrowser: () => setSavePreference((p) => (p === 'browser' ? null : 'browser')),
        });
        break;
      case 'backToProjects':
        setModal({
          kind: 'confirm',
          title: 'Back to Project Selector',
          message: 'This closes the current project. Anything not exported will be lost.',
          confirmLabel: 'Back to Projects',
          onConfirm: () => {
            setProjectOpen(false);
            setHistory([]);
            setFuture([]);
            setGateMode('choice');
            setGateName('');
            setGateInterval(10);
            setGateLoop(true);
            setGateRealistic(false);
            setGateFrames(4);
            setGateImportText('');
            setGateError('');
          },
        });
        break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'resetPose': resetPose(); break;
      case 'addStep': addStep(); break;
      case 'duplicateStep': duplicateStep(selectedStepRef.current); break;
      case 'deleteStep': deleteStep(selectedStepRef.current); break;
      case 'stepBack': stepBack(); break;
      case 'stepFwd': stepFwd(); break;
      case 'togglePlay': togglePlay(); break;
      case 'restart': restart(); break;
      case 'jumpToEnd': jumpToEnd(); break;
      case 'toggleLoop': toggleLoop(); break;
      case 'rename':
        setModal({
          kind: 'prompt',
          title: 'Rename animation',
          initial: animName,
          confirmLabel: 'Rename',
          onSubmit: (v) => {
            const clean = v.trim().replace(/\s+/g, '_');
            if (clean) { snapshot(); setAnimName(clean); }
          },
        });
        break;
      case 'setInterval':
        setModal({
          kind: 'prompt',
          title: 'Set interval (ticks)',
          initial: String(interval),
          confirmLabel: 'Set',
          onSubmit: (v) => {
            const n = parseInt(v, 10);
            if (!Number.isNaN(n) && n > 0) { snapshot(); setInterval(n); }
          },
        });
        break;
      case 'zoomIn': setZoom((z) => Math.min(2.5, round1(z + 0.2))); break;
      case 'zoomOut': setZoom((z) => Math.max(0.5, round1(z - 0.2))); break;
      case 'toggleGrid': setShowGrid((g) => !g); break;
      case 'resetCamera': viewportRef.current && viewportRef.current.resetView(); break;
      case 'toggleFocus': toggleFocus(); break;
      case 'workspaceAnimate': goWorkspace('animate'); break;
      case 'workspaceExport': goWorkspace('export'); break;
      case 'togglePoseInspector': setShowLeft((s) => !s); break;
      case 'toggleSettingsPanel': setShowRight((s) => !s); break;
      case 'resetLayout': resetLayout(); break;
      case 'openDocs':
        window.open('https://docs.advancedarmorstands.ir/', '_blank', 'noopener,noreferrer');
        break;
      case 'shortcuts':
        setModal({
          kind: 'info',
          title: 'Keyboard shortcuts',
          body: (
            <>
              <div><code>Ctrl K</code> / <code>⌘ K</code> — Open command search</div>
              <div><code>Space</code> — Play / Pause</div>
              <div><code>←</code> / <code>→</code> — Previous / next step</div>
              <div><code>Delete</code> / <code>Backspace</code> — Delete the selected step</div>
              <div><code>Delete</code> after a marquee drag — deletes any fully-selected steps; partially-selected steps just get those parts reset to 0 instead</div>
              <div><code>Ctrl Z</code> / <code>⌘ Z</code> — Undo</div>
              <div><code>Ctrl ⇧ Z</code> / <code>⌘ ⇧ Z</code> — Redo</div>
              <div><code>Ctrl/⌘ D</code> — Duplicate step</div>
              <div><code>Ctrl/⌘ S</code> — Download animations.yml</div>
              <div><code>Home</code> / <code>End</code> — Go to start / end</div>
              <div><code>+</code> / <code>-</code> — Zoom timeline in / out</div>
              <div><code>L</code> — Toggle loop</div>
              <div><code>G</code> — Toggle grid</div>
              <div><code>Shift</code> + drag a value — fine adjustment</div>
            </>
          ),
        });
        break;
      case 'about':
        setModal({
          kind: 'info',
          title: 'About AS Animator',
          body: 'The official pose and timeline editor for AdvancedArmorStands. Build a pose per step, scrub the timeline, and export straight to animations.yml.',
        });
        break;
      default: break;
    }
  }

  /* ---------------- outside click closes menu ---------------- */

  useEffect(() => {
    if (!openMenu) return undefined;
    const onDocClick = (e) => {
      if (!e.target.closest('.menu-wrap')) setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onDocClick);
    return () => document.removeEventListener('pointerdown', onDocClick);
  }, [openMenu]);

  /* ---------------- keyboard shortcuts ---------------- */

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        setPaletteIndex(0);
        return;
      }
      if (e.key === 'Escape' && paletteOpen) { setPaletteOpen(false); return; }
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { stepBack(); }
      else if (e.key === 'ArrowRight') { stepFwd(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateStep(selectedStepRef.current); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); handleSaveShortcut(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteOrResetSelection(); }
      else if (e.key === 'Home') { restart(); }
      else if (e.key === 'End') { jumpToEnd(); }
      else if (e.key === '+' || e.key === '=') { setZoom((z) => Math.min(2.5, round1(z + 0.2))); }
      else if (e.key === '-' || e.key === '_') { setZoom((z) => Math.max(0.5, round1(z - 0.2))); }
      else if (e.key.toLowerCase() === 'l') { toggleLoop(); }
      else if (e.key.toLowerCase() === 'g') { setShowGrid((g) => !g); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, future, steps, selectedDots, paletteOpen, savePreference]);

  /* ---------------- resizable timeline ---------------- */

  const resizeRef = useRef(null);
  const [resizing, setResizing] = useState(false);
  const onResizeDown = (e) => {
    resizeRef.current = { startY: e.clientY, startH: timelineHeight };
    setResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e) => {
    if (!resizeRef.current) return;
    const dy = resizeRef.current.startY - e.clientY;
    setTimelineHeight(Math.max(220, Math.min(640, resizeRef.current.startH + dy)));
  };
  const onResizeUp = () => { resizeRef.current = null; setResizing(false); };

  const scrubPct = steps.length > 1 ? selectedStep / (steps.length - 1) : 0;
  const scrubCurrentMs = selectedStep * interval * 50;
  const scrubTotalMs = steps.length > 1 ? (steps.length - 1) * interval * 50 : 0;
  const scrubRef = useRef(null);
  const scrubDragRef = useRef(false);
  const scrubToClientX = (clientX) => {
    const rect = scrubRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setIsPlaying(false);
    setSelectedStep(Math.round(pct * (steps.length - 1)));
  };
  const onScrubPointerDown = (e) => {
    scrubDragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubToClientX(e.clientX);
  };
  const onScrubPointerMove = (e) => {
    if (!scrubDragRef.current) return;
    scrubToClientX(e.clientX);
  };
  const onScrubPointerUp = () => { scrubDragRef.current = false; };

  const flags = {
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    canDeleteStep: steps.length > 1,
    canResetSavePref: savePreference !== null,
  };

  const paletteCommands = [];
  Object.entries(menus).forEach(([group, items]) => {
    items.forEach((item) => {
      if (item.divider) return;
      if (item.disabledKey && !flags[item.disabledKey]) return;
      paletteCommands.push({
        id: `${group}-${item.action}`,
        label: item.label,
        group,
        run: () => runMenuAction(item.action),
      });
    });
  });
  // Every other bit of live text in the project is searchable too, not just menu commands.
  paletteCommands.push(
    { id: 'txt-name', label: `Animation name: ${animName}`, group: 'Project', run: () => runMenuAction('rename') },
    { id: 'txt-interval', label: `Interval: ${interval} ticks`, group: 'Project', run: () => runMenuAction('setInterval') },
    { id: 'txt-loop', label: `Loop: ${loop ? 'On' : 'Off'}`, group: 'Project', run: toggleLoop },
    { id: 'txt-smooth', label: `Smooth animation: ${realisticEnabled ? 'On' : 'Off'}`, group: 'Project', run: () => setRealisticEnabled((v) => !v) },
    { id: 'txt-steps', label: `${steps.length} steps in this animation`, group: 'Project', run: () => {} },
  );
  PARTS.forEach((p) => {
    paletteCommands.push({
      id: `txt-part-${p}`,
      label: `Edit ${PART_META[p].label}`,
      group: 'Pose',
      run: () => { setExpanded((e) => ({ ...e, [p]: true })); setShowLeft(true); },
    });
  });

  const paletteQueryTrim = paletteQuery.trim().toLowerCase();

  function tryPaletteMath(q) {
    if (!/^[-+*/(). \d]+$/.test(q)) return null;
    if (!/\d/.test(q) || !/[+\-*/]/.test(q)) return null;
    try {
      // eslint-disable-next-line no-new-func
      const val = Function(`"use strict";return (${q})`)();
      if (typeof val !== 'number' || !Number.isFinite(val)) return null;
      return Math.round(val * 1e6) / 1e6;
    } catch { return null; }
  }
  const paletteMathValue = paletteQueryTrim ? tryPaletteMath(paletteQuery.trim()) : null;
  const paletteMathItem = paletteMathValue === null ? null : {
    id: 'math-result',
    label: `${paletteQuery.trim()} = ${paletteMathValue}`,
    group: 'Calculator',
    isMath: true,
    run: () => { navigator.clipboard && navigator.clipboard.writeText(String(paletteMathValue)); },
  };

  const paletteResults = (paletteQueryTrim
    ? paletteCommands
      .map((c) => {
        const label = c.label.toLowerCase();
        let score = 0;
        if (label === paletteQueryTrim) score = 100;
        else if (label.startsWith(paletteQueryTrim)) score = 80;
        else if (label.includes(paletteQueryTrim)) score = 50;
        else if (paletteQueryTrim.split(' ').every((w) => w && label.includes(w))) score = 30;
        return { ...c, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
    : paletteCommands
  ).slice(0, paletteMathItem ? 7 : 8);
  if (paletteMathItem) paletteResults.unshift(paletteMathItem);

  // Unambiguous best-match suggestion: only offer it when exactly one
  // command is a clear leader (startsWith) and no other candidate ties it.
  let paletteSuggestion = null;
  if (paletteQueryTrim) {
    const starts = paletteCommands.filter((c) => !c.disabled && c.label.toLowerCase().startsWith(paletteQueryTrim));
    if (starts.length === 1 && starts[0].label.toLowerCase() !== paletteQueryTrim) {
      paletteSuggestion = starts[0];
    }
  }

  function runPaletteCommand(cmd) {
    cmd.run();
    setPaletteOpen(false);
    if (!cmd.isMath) {
      setPaletteHistory((h) => [cmd.label, ...h.filter((q) => q !== cmd.label)].slice(0, 6));
    }
    setPaletteQuery('');
  }
  const paletteNavItems = !paletteQueryTrim
    ? [
      ...paletteHistory.map((q) => ({ id: `h-${q}`, label: q, isHistory: true, run: () => setPaletteQuery(q) })),
      ...paletteResults.map((r) => ({ ...r, isHistory: false, run: () => runPaletteCommand(r) })),
    ]
    : paletteResults.map((r) => ({ ...r, isHistory: false, run: () => runPaletteCommand(r) }));

  function onPaletteKeyDown(e) {
    if (e.key === 'Tab' && paletteSuggestion) { e.preventDefault(); setPaletteQuery(paletteSuggestion.label); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex((i) => Math.min(paletteNavItems.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (paletteNavItems[paletteIndex]) paletteNavItems[paletteIndex].run(); }
    else if (e.key === 'Escape') {
      if (paletteQueryTrim && paletteResults.length === 0) {
        setPaletteHistory((h) => [paletteQuery.trim(), ...h.filter((q) => q !== paletteQuery.trim())].slice(0, 6));
      }
      setPaletteOpen(false);
    }
  }

  if (!appReady) {
    return (
      <div className="aas-app" onContextMenu={openDefaultMenu}>
        <style>{CSS}</style>
        <div className="boot-screen">
          <div className="apple-spinner">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="apple-spinner-blade"
                style={{ transform: `rotate(${i * 30}deg)`, animationDelay: `${-(12 - i) / 12}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="aas-app" onContextMenu={openDefaultMenu}>
        <style>{CSS}</style>
        <div className="guard-screen">
          <div className="guard-box">
            <div className="guard-icon">🖥️</div>
            <div className="guard-title">Desktop only</div>
            <div className="guard-body">
              AS Animator needs a mouse, a keyboard and a real amount of screen space —
              phones and tablets aren't supported. Open this on a computer, or switch your
              browser to desktop mode if you're set on using a bigger tablet.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isTooSmall) {
    return (
      <div className="aas-app" onContextMenu={openDefaultMenu}>
        <style>{CSS}</style>
        <div className="guard-screen">
          <div className="guard-box">
            <div className="guard-icon">↔️</div>
            <div className="guard-title">Screen too small</div>
            <div className="guard-body">
              This window is too small to fit the editor (needs at least ~980×560px).
              Widen the browser window, undock it, or turn your device back to a normal
              orientation to keep using it.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!projectOpen) {
    return (
      <div className="aas-app" onContextMenu={openDefaultMenu}>
        <style>{CSS}</style>
        <div className="gate-screen">
          <div className="gate-left">
            <div className="gate-title">AS Animator</div>
            <div className="gate-sub">Pose &amp; timeline editor for AdvancedArmorStands. Build a pose per keyframe, scrub the timeline, export straight to <code>animations.yml</code>.</div>
          </div>
          <div className="gate-right">
            {gateMode === 'choice' && (
              <div className="gate-card">
                <button type="button" className="gate-btn primary" onClick={() => setGateMode('new')}>New Project</button>
                <button type="button" className="gate-btn" onClick={() => setGateMode('import')}>Import Project</button>
              </div>
            )}
            {gateMode === 'new' && (
              <div className="gate-card">
                <div className="gate-card-title">New Project</div>
                <label className="field">
                  <span>Name</span>
                  <input autoFocus className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={gateName} onChange={(e) => setGateName(e.target.value)} placeholder="unnamed" />
                </label>
                <div className="gate-options-row">
                  <div className="gate-options-label">
                    Project options
                    <button type="button" className="gate-reset-link" onClick={resetGateOptions}>Reset</button>
                  </div>
                  <label className="field">
                    <span>Interval (ticks)</span>
                    <input className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off" type="number" min="1" value={gateInterval} onChange={(e) => setGateInterval(Math.max(1, parseInt(e.target.value, 10) || 1))} />
                  </label>
                  <label className="field checkbox-field">
                    <span>Smooth animation</span>
                    <button type="button" className={`tick-box${gateRealistic ? ' on' : ''}`} onClick={() => setGateRealistic((v) => !v)}>
                      {gateRealistic && <Check size={12} />}
                    </button>
                  </label>
                  <label className={`field${gateRealistic ? '' : ' field-disabled'}`}>
                    <span>Interpolation frames</span>
                    <input className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off" type="number" min="1" disabled={!gateRealistic} value={gateFrames} onChange={(e) => setGateFrames(Math.max(1, parseInt(e.target.value, 10) || 1))} />
                  </label>
                  <label className="field checkbox-field">
                    <span>Loop</span>
                    <button type="button" className={`tick-box${gateLoop ? ' on' : ''}`} onClick={() => setGateLoop((l) => !l)}>
                      {gateLoop && <Check size={12} />}
                    </button>
                  </label>
                </div>
                <div className="gate-card-actions">
                  <button type="button" className="gate-btn" onClick={() => setGateMode('choice')}>Back</button>
                  <button type="button" className="gate-btn primary" onClick={createProject}>Create Project</button>
                </div>
              </div>
            )}
            {gateMode === 'import' && (
              <div className="gate-card">
                <div className="gate-card-title">Import Project</div>
                {browserSave && (
                  <>
                    <div className="gate-browser-save">
                      <div className="gate-browser-save-info">
                        <strong>{browserSave.animName}</strong>
                        <span>{browserSave.steps.length} steps</span>
                      </div>
                      <div className="gate-browser-save-actions">
                        <button type="button" className="gate-btn primary" onClick={importFromBrowser}>Import from browser</button>
                        <button type="button" className="gate-btn" onClick={deleteBrowserSave}>Delete</button>
                      </div>
                    </div>
                    <div className="gate-divider"><span>or</span></div>
                  </>
                )}
                <div className="hint">Paste your <code>animations.yml</code> (or just one animation block) below.</div>
                <textarea
                  autoFocus
                  className="yaml-preview" spellCheck={false} autoCorrect="off" autoCapitalize="off"
                  style={{ minHeight: 160 }}
                  value={gateImportText}
                  onChange={(e) => { setGateImportText(e.target.value); setGateError(''); }}
                  placeholder={'wave:\n  interval: 10\n  loop: true\n  realistic-animations:\n    enabled: false\n    frames: 1\n  steps:\n    - head:\n        x: 0\n        ...'}
                />
                {gateImportNames.length > 1 && (
                  <label className="field">
                    <span>Found {gateImportNames.length} animations — import which one?</span>
                    <select className="text-input" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={gateImportPick || gateImportNames[0]} onChange={(e) => setGateImportPick(e.target.value)}>
                      {gateImportNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
                {gateError && <div className="modal-error">{gateError}</div>}
                <div className="gate-card-actions">
                  <button type="button" className="gate-btn" onClick={() => setGateMode('choice')}>Back</button>
                  <button type="button" className="gate-btn primary" onClick={importProjectFromGate}>Import</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aas-app" onContextMenu={openDefaultMenu}>
      <style>{CSS}</style>

      <MenuBar menus={menus} openMenu={openMenu} setOpenMenu={setOpenMenu} onAction={runMenuAction} flags={flags} />

      <div className="toolbar">
        <div className="workspace-tabs">
          <div className={`workspace-tab${workspace === 'animate' ? ' active' : ''}`} onClick={() => goWorkspace('animate')}>Animate</div>
          <div className={`workspace-tab${workspace === 'export' ? ' active' : ''}`} onClick={() => goWorkspace('export')}>Export</div>
        </div>
        <div className="toolbar-title">
          AS Animator — {animName || 'unnamed'}
          {savedSnapshot !== null && (
            <span className={`save-status${savedSnapshot !== currentAnimSnapshot() ? ' dirty' : ''}`}>
              {savedSnapshot !== currentAnimSnapshot() ? 'Unsaved' : 'Saved'}
            </span>
          )}
        </div>
        <div className="toolbar-spacer" />
        {workspace === 'animate' && (
          <button type="button" className="icon-ghost-btn" onClick={toggleFocus} title={(showLeft || showRight) ? 'Focus viewport' : 'Show panels'}>
            {(showLeft || showRight) ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </button>
        )}
      </div>

      {workspace === 'export' ? (
        <ExportWorkspace
          animName={animName}
          interval={interval}
          loop={loop}
          realisticEnabled={realisticEnabled}
          realisticFrames={realisticFrames}
          steps={steps}
          fullYaml={fullYaml}
          copySnippet={copySnippet}
          downloadYaml={downloadYaml}
          copyStatus={copyStatus}
          downloadStatus={downloadStatus}
          onSaveBrowser={saveProjectToBrowser}
          saveBrowserStatus={saveBrowserStatus}
        />
      ) : (
        <>
          <div className="body-row">
            {showLeft && (
              <DockZone
                zoneId="left"
                panelIds={layout.left}
                activeId={activeTab.left}
                onActivate={(zoneId, id) => setActiveTab((prev) => ({ ...prev, [zoneId]: id }))}
                onDragStartTab={onDragStartTab}
                onDragOverZone={onDragOverZone}
                onDragLeaveZone={onDragLeaveZone}
                onDropTab={onDropTab}
                onDragEndTab={onDragEndTab}
                isDropTarget={dropZone === 'left'}
                isDraggingAnything={!!dragPanel}
                renderContent={renderPanelContent}
              />
            )}

            <div className="viewport-panel">
              <div className="viewport-wrap" onContextMenu={openViewportMenu}>
                <Viewport ref={viewportRef} initialShowGrid={showGrid} initialShowShadows={showShadows} initialRealistic={realisticModel} locked={viewportLocked} />
                <div className="viewport-settings">
                  <button type="button" className="viewport-settings-btn" onClick={() => setViewportSettingsOpen((o) => !o)} title="Viewport settings">
                    <Settings2 size={15} />
                  </button>
                  {viewportSettingsOpen && (
                    <div className="viewport-settings-menu">
                      <button type="button" className="menu-dd-item" onClick={() => setShowGrid((g) => !g)}>
                        <span><Grid3x3 size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Grid</span>
                        <span>{showGrid ? 'On' : 'Off'}</span>
                      </button>
                      <button type="button" className="menu-dd-item" onClick={() => setShowShadows((v) => !v)}>
                        <span><Sun size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Shadows</span>
                        <span>{showShadows ? 'On' : 'Off'}</span>
                      </button>
                      <button type="button" className="menu-dd-item" onClick={() => setRealisticModel((v) => !v)} title="Ticked = vanilla-style pixel armor stand. Unticked = the original simple model and camera framing.">
                        <span><Box size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Minecraft model</span>
                        <span>{realisticModel ? 'On' : 'Off'}</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="viewport-hint">drag to orbit · scroll to zoom</div>
                <button
                  type="button"
                  className="viewport-lock-btn"
                  onClick={() => setViewportLocked((l) => !l)}
                  title={viewportLocked ? 'Unlock camera' : 'Lock camera'}
                >
                  {viewportLocked ? <Lock size={15} /> : <Unlock size={15} />}
                </button>
              </div>

              <div
                className={`scrub-strip${isPlaying ? ' playing' : ''}`}
                ref={scrubRef}
                onPointerDown={onScrubPointerDown}
                onPointerMove={onScrubPointerMove}
                onPointerUp={onScrubPointerUp}
              >
                <div ref={scrubFillRef} className="scrub-fill" style={{ width: `${scrubPct * 100}%` }} />
                <div ref={scrubMarkerRef} className="scrub-marker" style={{ left: `${scrubPct * 100}%` }} />
                <div className="scrub-step-readout">
                  STEP {String(selectedStep + 1).padStart(2, '0')}/{String(steps.length).padStart(2, '0')}
                  <span className="sub">tick {selectedStep * interval}</span>
                </div>
                <div className="scrub-time">
                  <span ref={scrubTimeRef}>{formatTime(scrubCurrentMs)}</span>
                  <span className="scrub-time-total"> / {formatTime(scrubTotalMs)}</span>
                </div>
              </div>

              <div className="transport-bar">
                <button type="button" className="transport-btn" onClick={restart} title="Go to first step"><SkipBack size={16} /></button>
                <button type="button" className="transport-btn" onClick={stepBack} title="Previous step"><StepBack size={16} /></button>
                <button type="button" className="transport-btn play" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button type="button" className="transport-btn" onClick={stepFwd} title="Next step"><StepForward size={16} /></button>
                <button type="button" className="transport-btn" onClick={jumpToEnd} title="Go to last step"><SkipForward size={16} /></button>
                <button type="button" className={`transport-btn${loop ? ' on' : ''}`} onClick={toggleLoop} title="Toggle loop"><Repeat size={16} /></button>
              </div>
            </div>

            {showRight && (
              <DockZone
                zoneId="right"
                panelIds={layout.right}
                activeId={activeTab.right}
                onActivate={(zoneId, id) => setActiveTab((prev) => ({ ...prev, [zoneId]: id }))}
                onDragStartTab={onDragStartTab}
                onDragOverZone={onDragOverZone}
                onDragLeaveZone={onDragLeaveZone}
                onDropTab={onDropTab}
                onDragEndTab={onDragEndTab}
                isDropTarget={dropZone === 'right'}
                isDraggingAnything={!!dragPanel}
                renderContent={renderPanelContent}
              />
            )}
          </div>

          <DockZone
            zoneId="bottom"
            panelIds={layout.bottom}
            activeId={activeTab.bottom}
            onActivate={(zoneId, id) => setActiveTab((prev) => ({ ...prev, [zoneId]: id }))}
            onDragStartTab={onDragStartTab}
            onDragOverZone={onDragOverZone}
            onDragLeaveZone={onDragLeaveZone}
            onDropTab={onDropTab}
            onDragEndTab={onDragEndTab}
            isDropTarget={dropZone === 'bottom'}
            isDraggingAnything={!!dragPanel}
            renderContent={renderPanelContent}
            horizontal
          />

          <div
            className={`resize-handle${resizing ? ' active' : ''}`}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />

          <div style={{ height: timelineHeight, flexShrink: 0, display: 'flex' }}>
            <Timeline
              steps={steps}
              selectedStep={selectedStep}
              setSelectedStep={(i) => { setIsPlaying(false); setSelectedStep(i); }}
              interval={interval}
              addStep={addStep}
              duplicateStep={duplicateStep}
              deleteStep={deleteStep}
              zoom={zoom}
              setZoom={setZoom}
              playheadRef={playheadRef}
              lockedParts={lockedParts}
              hiddenParts={hiddenParts}
              toggleLocked={toggleLocked}
              toggleHidden={toggleHidden}
              isPlaying={isPlaying}
              onMoveStep={moveStep}
              scrollAreaRef={scrollAreaRef}
              partOrder={partOrder}
              setPartOrder={setPartOrder}
              onDotContextMenu={openDotMenu}
              onTimelineContextMenu={openTimelineMenu}
              selectedDots={selectedDots}
              setSelectedDots={setSelectedDots}
            />
          </div>
        </>
      )}

      <Modal modal={modal} onClose={() => setModal(null)} savePref={savePreference} />
      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
      {paletteOpen && (
        <div className="palette-overlay" onClick={() => setPaletteOpen(false)}>
          <div className="palette-box" onClick={(e) => e.stopPropagation()}>
            <div className="palette-input-row">
              <div className="palette-ghost">
                <span className="ghost-typed">{paletteQuery}</span>
                <span className="ghost-suffix">{paletteSuggestion ? paletteSuggestion.label.slice(paletteQuery.length) : ''}</span>
              </div>
              <input
                autoFocus
                className="palette-input"
                value={paletteQuery}
                onFocus={(e) => e.target.select()}
                onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0); }}
                onKeyDown={onPaletteKeyDown}
                placeholder="Search actions, commands…"
              />
              {paletteSuggestion && <span className="palette-tab-badge">Tab</span>}
            </div>
            <div className="palette-results">
              {!paletteQueryTrim && paletteHistory.length > 0 && <div className="palette-section-label">Recent</div>}
              {paletteNavItems.length === 0 && <div className="palette-empty">No matching commands</div>}
              {paletteNavItems.map((r, i) => (
                <React.Fragment key={r.id}>
                  {i === paletteHistory.length && !paletteQueryTrim && paletteHistory.length > 0 && (
                    <div className="palette-section-label">Suggestions</div>
                  )}
                  <button
                    type="button"
                    className={`palette-item${r.isHistory ? ' history' : ''}${i === paletteIndex ? ' active' : ''}`}
                    onMouseEnter={() => setPaletteIndex(i)}
                    onClick={() => r.run()}
                  >
                    <span>{r.label}</span>
                    {r.isHistory ? <CornerDownRight size={12} className="palette-history-icon" /> : <span className="palette-group">{r.group}</span>}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
