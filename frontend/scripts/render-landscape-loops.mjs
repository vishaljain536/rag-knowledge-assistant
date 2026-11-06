import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// Coordinates trace the moving parts of the original 1672 × 941 artwork.
const falls = [
  [[1265, 99], [1293, 107], [1261, 221], [1230, 367], [1213, 445],
    [1075, 443], [1079, 369], [1110, 235], [1232, 188]],
  [[1104, 484], [1147, 490], [1180, 514], [1204, 541], [1170, 617],
    [1198, 611], [1183, 685], [1145, 777], [1002, 774], [961, 686],
    [950, 631], [986, 565], [1039, 516]],
];
const river = [[1025, 753], [1176, 767], [1227, 804], [1351, 833], [1450, 941],
  [1087, 941], [1011, 852], [970, 806]];
const lake = [[350, 597], [1483, 598], [1469, 657], [1414, 733], [1341, 790],
  [1231, 817], [1198, 867], [1047, 920], [972, 941], [755, 941], [676, 886],
  [544, 897], [467, 855], [440, 807], [331, 822], [269, 805], [237, 751]];
const aurora = [
  [[553, 88], [716, 129], [815, 133], [855, 61], [1005, 36], [1072, 0],
    [1166, 0], [1129, 119], [1022, 163], [966, 218], [957, 294], [887, 278],
    [837, 210], [711, 224], [607, 176]],
  [[1303, 205], [1377, 169], [1462, 133], [1470, 199], [1382, 267], [1306, 267]],
];
const canyon = [[1340, 133], [1672, 139], [1672, 552], [1456, 573], [1378, 464],
  [1312, 357], [1285, 255]];

const width = 1280;
const height = 720;
const seconds = 6;
const sx = width / 1672;
const sy = height / 941;
const tau = 2 * Math.PI;
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const [gifDirArg, ...requested] = process.argv.slice(2);
if (!gifDirArg) throw new Error("Usage: node render-landscape-loops.mjs <GIF output directory> [theme IDs]");
const gifDir = resolve(gifDirArg);
mkdirSync(gifDir, { recursive: true });

function clamp(x) { return Math.min(1, Math.max(0, x)); }
function ramp(a, b, x) {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function randomAt(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

const noiseSize = 64;
const noise = Float32Array.from({ length: noiseSize ** 2 }, (_, index) => randomAt(index));

// This texture tiles along the flow direction. Translating it by a full tile
// per loop sends new foam downstream continuously, including across the seam.
function flowNoise(across, along) {
  const column = Math.floor(across);
  const row = Math.floor(along);
  const u = ramp(0, 1, across - column);
  const v = ramp(0, 1, along - row);
  const x0 = column & (noiseSize - 1);
  const x1 = (column + 1) & (noiseSize - 1);
  const a = (row & (noiseSize - 1)) * noiseSize;
  const b = ((row + 1) & (noiseSize - 1)) * noiseSize;
  const top = noise[a + x0] * (1 - u) + noise[a + x1] * u;
  const bottom = noise[b + x0] * (1 - u) + noise[b + x1] * u;
  return top * (1 - v) + bottom * v;
}

function feather(poly, x, y, edge) {
  let inside = false;
  let distance = edge * edge;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * dx / dy) inside = !inside;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
    distance = Math.min(distance, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2);
  }
  return inside ? ramp(0, edge, Math.sqrt(distance)) : 0;
}

function readArtwork(id) {
  const result = spawnSync("ffmpeg", [
    "-v", "error", "-i", join(publicDir, id + ".webp"), "-vf", `scale=${width}:${height}:flags=lanczos`,
    "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ], { maxBuffer: width * height * 3 + 4096, windowsHide: true });
  if (result.error || result.status !== 0 || result.stdout.length !== width * height * 3) {
    throw result.error ?? new Error(result.stderr.toString() || "Unexpected artwork dimensions");
  }
  return result.stdout;
}

function motionPixels(id, pixels) {
  const regions = [];
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = px / sx, y = py / sy, i = 3 * (py * width + px);
    if (id === "archive-falls" && x > 944 && x < 1451 && y > 98) {
      const teal = ramp(11, 75, pixels[i + 1] - pixels[i]) * ramp(55, 127, pixels[i + 1]);
      if (teal === 0) continue;
      const stream = Math.max(...falls.map(poly => feather(poly, x, y, 17))) * teal;
      const pool = feather(river, x, y, 23) * teal * (1 - stream);
      if (stream || pool) regions.push({ i, x, y, stream, pool });
    } else if (id === "moonlit-observatory" && x > 230 && x < 1490) {
      const water = y > 595 ? feather(lake, x, y, 25) : 0;
      const violet = y < 300 && x > 550 ? Math.max(...aurora.map(poly => feather(poly, x, y, 40)))
        * ramp(25, 115, pixels[i + 2]) * ramp(0, 35, pixels[i] - pixels[i + 1] + 14) : 0;
      if (water || violet) regions.push({ i, x, y, px, py, water, violet });
    } else if (id === "ember-canyon" && x > 990 && y > 118 && y < 575) {
      const air = x > 1285 ? feather(canyon, x, y, 27) : 0;
      const dx = x - 1526, dy = y - 205;
      const radius = Math.hypot(dx, dy);
      const halo = Math.exp(-((dx / 110) ** 2 + (dy / 48) ** 2));
      const beam = ramp(10, 50, radius) * (1 - ramp(170, 330, radius)) * ramp(-8, 28, dy);
      const archEnvelope = ramp(118, 206, y) * (1 - ramp(365, 540, y));
      const archDistance = x - (1282 - .48 * (y - 145));
      const sandstone = ramp(30, 155, pixels[i]) * ramp(5, 75, pixels[i] - pixels[i + 2]);
      const arch = archEnvelope * (.48 + .52 * sandstone) * (1 - ramp(100, 145, Math.abs(archDistance)));
      if (air || arch) regions.push({ i, air, halo, beam, angle: Math.atan2(dy, -dx), arch, archDistance, y });
    }
  }
  return regions;
}

function sample(frame, source, i, x, y, shimmer, color) {
  x = Math.max(0, Math.min(width - 1.001, x));
  y = Math.max(0, Math.min(height - 1.001, y));
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, p = 3 * (iy * width + ix), stride = width * 3;
  for (let c = 0; c < 3; c++) {
    const top = source[p + c] * (1 - fx) + source[p + 3 + c] * fx;
    const bottom = source[p + stride + c] * (1 - fx) + source[p + stride + 3 + c] * fx;
    frame[i + c] = Math.round(Math.max(0, Math.min(255, top * (1 - fy) + bottom * fy + shimmer * color[c])));
  }
}

function warmDust(frame, phase) {
  for (let n = 1; n <= 96; n++) {
    const t = (phase / tau * (n % 3 === 0 ? 2 : 1) + randomAt(n)) % 1;
    const x = (1038 + randomAt(n + 251) * 236 + 62 * t + Math.sin(tau * t) * 12) * sx;
    const y = (272 + randomAt(n + 503) * 170 - 100 * t) * sy;
    const glow = Math.sin(Math.PI * t) ** 2 * (31 + 92 * randomAt(n + 641));
    const radius = .65 + randomAt(n + 113) * 1.1;
    for (let py = Math.floor(y) - 3; py <= Math.floor(y) + 3; py++) {
      for (let px = Math.floor(x) - 3; px <= Math.floor(x) + 3; px++) {
        const i = 3 * (py * width + px);
        const light = glow * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (radius * radius));
        frame[i] = Math.min(255, frame[i] + light);
        frame[i + 1] = Math.min(255, frame[i + 1] + light * .69);
        frame[i + 2] = Math.min(255, frame[i + 2] + light * .33);
      }
    }
  }
}

const moonLight = [.89, .92, 1], violetLight = [.93, .61, 1];
function addLight(frame, index, light, red, green, blue) {
  frame[index] = Math.max(0, Math.min(255, frame[index] + light * red));
  frame[index + 1] = Math.max(0, Math.min(255, frame[index + 1] + light * green));
  frame[index + 2] = Math.max(0, Math.min(255, frame[index + 2] + light * blue));
}

function flowWater(frame, points, cycle) {
  const travel = cycle * noiseSize;
  for (const { i, x, y, stream, pool } of points) {
    let light = 0;
    if (stream) {
      // The bright threads follow the slope of the water without moving its banks.
      const across = x + .23 * y + 2.3 * Math.sin(y * .034);
      const sheets = flowNoise(across / 8, y / 18 - travel);
      const streaks = flowNoise(across / 3.7 + 19, y / 11 - travel * 2);
      light += stream * ((sheets - .5) * 40 + (streaks - .5) * 33);
    }
    if (pool) {
      // Below the splash pool the current turns toward the lower right.
      const across = .78 * x - .63 * y;
      const along = .63 * x + .78 * y;
      const foam = flowNoise(across / 11, along / 9 - travel);
      light += pool * (foam - .5) * 41;
    }
    addLight(frame, i, light, .74, 1, .93);
  }
}

function shineThroughCanyon(frame, points, t) {
  const sweep = Math.sin(t - .28);
  for (const { i, air, halo, beam, angle, arch, archDistance, y } of points) {
    const ray = (center, spread) => Math.exp(-(((angle - center) / spread) ** 2));
    const rays = 73 * ray(.56 + .16 * sweep, .087) * (.65 + .35 * Math.sin(t + .47))
      + 56 * ray(.82 + .12 * sweep, .07) * (.62 + .38 * Math.cos(t + .39))
      + 34 * ray(.37 + .09 * sweep, .078) * (.62 + .38 * Math.sin(2 * t + .41));
    const horizon = air * (beam * (rays - 10) + halo * (8 + 14 * Math.sin(t + .9)));

    // The foreground shaft passes over the arch face inside the mobile crop.
    const shift = 23 * Math.sin(t - y * .003);
    const shaft = Math.exp(-(((archDistance - shift) / 42) ** 2));
    const reflected = arch * (shaft * (25 + 25 * Math.sin(t - .7)) - 5);
    addLight(frame, i, horizon + reflected, 1, .68, .36);
  }
  warmDust(frame, t);
}

function render(id, source, points, t) {
  const frame = Buffer.from(source);
  if (id === "archive-falls") {
    flowWater(frame, points, t / tau);
  } else if (id === "moonlit-observatory") {
    for (const { i, x, y, px, py, water, violet } of points) {
      const a = 2 * t - .095 * y + .015 * x + 2.4 * Math.log1p(Math.max(0, y - 594) * .045);
      const b = 3 * t - .155 * y - .011 * x;
      const reflection = ramp(23, 155, source[i + 2]);
      const pulse = Math.sin(t - .021 * x + .003 * y);
      if (water) sample(frame, source, i, px + sx * water * (4 * Math.sin(a) + 2 * Math.sin(b)),
        py + sy * water * (.95 * Math.sin(a) + .85 * Math.sin(b)),
        water * reflection * (9 * Math.sin(a + 1) + 5 * Math.sin(b)), moonLight);
      else sample(frame, source, i, px + sx * violet * (4 * pulse + 2 * Math.sin(2 * t - .047 * x)),
        py, violet * (15 * pulse + 7 * Math.sin(2 * t - .035 * x)), violetLight);
    }
  } else {
    shineThroughCanyon(frame, points, t);
  }
  return frame;
}

async function encode(id) {
  const source = readArtwork(id);
  const points = motionPixels(id, source);
  const fps = id === "moonlit-observatory" ? 20 : 25;
  const frameCount = fps * seconds;
  // Fine dust and slow gradients can show a jump when the video loops back
  // to its opening keyframe. Give those frames similar quantization.
  const videoQuality = id === "ember-canyon"
    ? ["-qp", "11", "-x264-params", "ipratio=1:pbratio=1"]
    : ["-crf", "21"];
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", String(fps), "-i", "pipe:0",
    "-filter_complex_threads", "2", "-filter_complex",
    "[0:v]split[web][gif];[gif]scale=1024:576:flags=lanczos,split[g][p];" +
      "[p]palettegen=stats_mode=full[palette];[g][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[loop]",
    "-map", "[web]", "-c:v", "libx264", "-preset", "slow", ...videoQuality, "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", join(publicDir, id + "-loop.mp4"),
    "-map", "[loop]", "-loop", "0", join(gifDir, id + ".gif"),
  ], { stdio: ["pipe", "ignore", "inherit"], windowsHide: true });
  function* frames() {
    for (let index = 0; index < frameCount; index++) {
      yield render(id, source, points, tau * index / frameCount);
    }
  }
  const finished = once(ffmpeg, "close").then(([code]) => {
    if (code !== 0) throw new Error(`FFmpeg failed to encode ${id}: ${code}`);
  });
  await Promise.all([pipeline(Readable.from(frames()), ffmpeg.stdin), finished]);
  console.log(`Rendered ${id}`);
}

const themes = ["archive-falls", "moonlit-observatory", "ember-canyon"];
for (const id of requested.length ? requested : themes) {
  if (!themes.includes(id)) throw new Error(`Unknown theme: ${id}`);
  await encode(id);
}
