import {
  BufferGeometry, Color, Float32BufferAttribute, PerspectiveCamera, Points,
  Scene, ShaderMaterial, Vector2, WebGLRenderer,
} from "three";

const pointCount = 132;
const pixelBudget = 1_200_000;

export function mountLandscapeMotion(stage: HTMLElement, art: HTMLElement, layer: HTMLElement) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { alpha: true, antialias: false, powerPreference: "low-power" });
  if (!context) return;

  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: false });
  const scene = new Scene();
  const camera = new PerspectiveCamera(47, 1, 0.1, 50);
  const tint = new Color();
  const resolution = { value: 1 };
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { tint: { value: tint }, resolution },
    vertexShader: `
      attribute vec2 spark;
      uniform float resolution;
      varying float opacity;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(spark.x * 12.0 / -view.z, 1.8, 8.0) * resolution;
        opacity = spark.y;
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      varying float opacity;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        float halo = 1.0 - smoothstep(0.04, 0.5, radius);
        float core = 1.0 - smoothstep(0.0, 0.16, radius);
        gl_FragColor = vec4(mix(tint, vec3(1.0), core * 0.55), halo * opacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const positions = [];
  const sparks = [];
  for (let index = 0; index < pointCount; index++) {
    positions.push((Math.random() - 0.35) * 22, (Math.random() - 0.5) * 11, Math.random() * 10 - 6);
    sparks.push(1.7 + Math.random() * 2.8, 0.18 + Math.random() * 0.48);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("spark", new Float32BufferAttribute(sparks, 2));
  scene.add(new Points(geometry, material));
  layer.append(canvas);

  const target = new Vector2();
  const position = new Vector2();
  let frame = 0;
  let disposed = false;

  function schedule() {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  }

  function draw() {
    frame = 0;
    position.lerp(target, 0.19);
    const moving = position.distanceToSquared(target) > 0.0001;
    if (!moving) position.copy(target);
    camera.position.set(position.x * 0.8, position.y * 0.52, 10);
    camera.lookAt(0, 0, 0);
    art.style.transform = `translate3d(${position.x * -10}px, ${position.y * 8}px, 0)`;
    renderer.render(scene, camera);
    if (moving) schedule();
  }

  function pointer(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    const bounds = stage.getBoundingClientRect();
    target.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    schedule();
  }

  function settle() {
    target.set(0, 0);
    schedule();
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = layer;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.25, Math.sqrt(pixelBudget / (width * height)));
    resolution.value = ratio;
    renderer.setDrawingBufferSize(width, height, ratio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    schedule();
  }

  function updateTint() {
    tint.set(getComputedStyle(stage).getPropertyValue("--accent").trim());
    schedule();
  }

  const sizeObserver = new ResizeObserver(resize);
  const themeObserver = new MutationObserver(updateTint);
  sizeObserver.observe(layer);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  stage.addEventListener("pointermove", pointer, { passive: true });
  stage.addEventListener("pointerleave", settle);
  canvas.addEventListener("webglcontextlost", dispose);
  updateTint();
  resize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    sizeObserver.disconnect();
    themeObserver.disconnect();
    stage.removeEventListener("pointermove", pointer);
    stage.removeEventListener("pointerleave", settle);
    canvas.removeEventListener("webglcontextlost", dispose);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    art.style.removeProperty("transform");
  }

  return dispose;
}
