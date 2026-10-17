/* Three r128: original procedural skylines and pointer-driven liquid illumination. */
(function () {
  'use strict';
  const vertex = `
    varying vec3 vWorld; varying vec3 vNormal; varying vec2 vScreen; varying vec3 vTint;
    void main() {
      vec4 p = vec4(position, 1.0); vec3 n = normal;
      vTint = vec3(1.0);
      #ifdef USE_COLOR
        vTint = color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vTint = instanceColor;
      #endif
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
        mat3 m = mat3(instanceMatrix);
        n /= vec3(dot(m[0],m[0]), dot(m[1],m[1]), dot(m[2],m[2])); n = m * n;
      #endif
      vec4 world = modelMatrix * p; vWorld = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * n);
      vec4 clip = projectionMatrix * viewMatrix * world;
      vScreen = clip.xy / clip.w * .5 + .5; gl_Position = clip;
    }`;
  const fragment = `
    uniform vec3 uBase, uBlue; uniform float uTime, uOpacity, uGlow, uAspect, uWater, uDark, uActor;
    uniform vec2 uTrail[5];
    varying vec3 vWorld; varying vec3 vNormal; varying vec2 vScreen; varying vec3 vTint;
    void main() {
      vec2 uv = vScreen; float pool = 0.0;
      vec2 warp = vec2(sin(uv.y * 20.0 + uTime * .55), cos(uv.x * 16.0 - uTime * .4)) * .012;
      for (int i = 0; i < 5; i++) {
        vec2 d = (uv + warp - uTrail[i]) * vec2(uAspect, 1.0);
        pool = max(pool, exp(-dot(d, d) * (26.0 + float(i) * 5.0)) * (1.0 - float(i) * .13));
      }
      float ripples = .65 + .35 * sin(vWorld.x * 2.1 + sin(vWorld.y * 2.4 + uTime * .8) - uTime * .9);
      float flow = clamp(pool * uGlow * ripples, 0.0, 1.0);
      float shade = .55 + .45 * max(dot(normalize(vNormal), normalize(vec3(-.7, 1.0, 1.0))), 0.0);
      vec3 base = uBase * vTint * shade * 1.35;
      vec2 facade = vec2(abs(vNormal.x) > .5 ? vWorld.z : vWorld.x, vWorld.y);
      vec2 grid = fract(facade * vec2(6.0, 5.0));
      float windows = step(.23, grid.x) * step(grid.x, .66) * step(.28, grid.y) * step(grid.y, .64);
      windows *= (1.0 - step(.6, abs(vNormal.y))) * (1.0 - uActor);
      base *= 1.0 - windows * .1 * (1.0 - uWater);
      vec3 lit = mix(base, uBlue, flow * .64);
      lit += uBlue * windows * (.065 + flow * .55) * (1.0 - uWater);
      float occupied = step(.76, fract(sin(dot(floor(facade * vec2(6.0,5.0)), vec2(12.9898,78.233))) * 43758.5453));
      lit += vec3(.32,.22,.09) * occupied * windows * uDark * .28;
      float veins = pow(.5 + .5 * sin(vWorld.x * 1.25 + vWorld.z * 2.1 + sin(vWorld.z * 1.4 - uTime * .4)), 12.0);
      lit = mix(lit, uBlue * (.8 + veins * .5), uWater * (.28 + flow * .45));
      float alpha = (.66 + flow * .18 + uActor * .25) * uOpacity;
      alpha = mix(alpha, (.22 + flow * .36) * uOpacity, uWater);
      // Reading surfaces are real translucent CSS glass, never holes painted into the city.
      alpha *= smoothstep(.02, .17, uv.y);
      gl_FragColor = vec4(lit, alpha);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`;
  function JourneyScene(options) {
    this.container = document.getElementById(options.container); this.canvas = document.getElementById(options.canvas);
    if (!this.container || !this.canvas) return;
    this.hero = document.querySelector('.product-hero'); this.stage = document.documentElement;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.pointer = matchMedia('(hover: hover) and (pointer: fine)');
    this.elapsed = 0; this.lastFrame = null; this.frame = null; this.progress = 0; this.scrollTarget = 0;
    this.inView = true; this.contextLost = false; this.disposed = false; this.overlayOpen = false; this.cleanups = [];
    this.target = { x: .5, y: .5 }; this.velocity = { x: 0, y: 0 }; this.offset = { x: .5, y: .5 };
    this.glow = 0; this.glowTarget = 0; this.materials = [];
    this.paused = false; this.introUntil = performance.now() + 3600; this.inputUntil = 0;
    try {
      if (!window.THREE || !window.XettlSkylineGeometry) throw new Error('No renderer');
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(1); this.renderer.setClearColor(0, 0);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.scene = new THREE.Scene(); this.camera = new THREE.OrthographicCamera(-18, 18, 10, -10, .1, 120);
      this.group = new THREE.Group(); this.scene.add(this.group);
      this.trail = Array.from({ length: 5 }, () => new THREE.Vector2(.5, .5));
      this.shared = { uTime: { value: 0 }, uGlow: { value: 0 }, uAspect: { value: 1 }, uTrail: { value: this.trail },
        uBase: { value: new THREE.Color() }, uBlue: { value: new THREE.Color() }, uDark: { value: 0 } };
      this.cities = XettlSkylineGeometry.build(THREE, (water) => this.makeMaterial(water));
      this.cities.forEach(city => this.group.add(city.group));
      this.setProgress(0);
      this.liquid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 112, 20), this.makeMaterial(1));
      this.liquid.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      this.liquid.frustumCulled = false; this.group.add(this.liquid);
      this.life = new XettlCityLife(THREE, this.makeMaterial(2)); this.group.add(this.life.mesh, this.life.details);
      this.buildGround(); this.updateTravel(); this.bind(); this.resize(); this.theme(); this.updateScroll();
      this.container.classList.add('journey-ready'); this.hero.classList.add('skyline-interactive');
      this.initialized = true;
      this.sync();
    } catch (_) {
      this.failure = _.message;
      this.dispose(); this.container.classList.add('scene-fallback');
    }
  }
  JourneyScene.prototype.makeMaterial = function (water) {
    const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment,
      uniforms: Object.assign({}, this.shared, { uOpacity: { value: 1 }, uWater: { value: water === 1 ? 1 : 0 }, uActor: { value: water === 2 ? 1 : 0 } }),
      transparent: true, vertexColors: true, depthWrite: water !== 1, side: water === 1 ? THREE.DoubleSide : THREE.FrontSide });
    this.materials.push(material); return material;
  };
  JourneyScene.prototype.buildGround = function () {
    const geometry = new THREE.PlaneGeometry(44, 14);
    const ground = new THREE.Mesh(geometry, this.makeMaterial(1));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -.08, -1);
    ground.material.uniforms.uOpacity.value = .24; this.group.add(ground);
  };
  JourneyScene.prototype.updateTravel = function () {
    const positions = this.liquid.geometry.attributes.position;
    for (let row = 0; row <= 20; row++) for (let col = 0; col <= 112; col++) {
      const t = col / 112, u = row / 20 - .5;
      const x = (t - .5) * 44, z = 3 + Math.sin(t * Math.PI * 2) * 1.1 + u * 3.2;
      const y = .06 + .15 * Math.sin(t * 16 - this.elapsed * .5 + u * 2) + .06 * Math.sin(u * 9 + t * 7 - this.elapsed * .3);
      positions.setXYZ(row * 113 + col, x, y, z);
    }
    positions.needsUpdate = true; this.liquid.geometry.computeVertexNormals();
    this.shared.uTime.value = this.elapsed;
    if (this.life) this.life.update(this.elapsed, this.actorDelta || 0, this.camera, this.group, this.offset, this.glow > .15, this.actorCeiling || 12);
  };
  JourneyScene.prototype.updateScroll = function () {
    if (!this.hero) return;
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
    const product = document.getElementById('product'), faq = document.getElementById('faq');
    const middle = product ? product.getBoundingClientRect().top + scrollY - header : innerHeight;
    const end = faq ? faq.getBoundingClientRect().top + scrollY - header : middle * 2;
    const y = window.scrollY;
    this.scrollTarget = y <= middle ? .5 * y / Math.max(1, middle) : .5 + .5 * (y - middle) / Math.max(1, end - middle);
    this.scrollTarget = Math.max(0, Math.min(1, this.scrollTarget));
    // Touch follows native scrolling without an idle animation loop or moving street actors.
    if (!this.pointer.matches && !this.motion.matches && !this.paused && !this.contextLost && !this.overlayOpen) {
      this.setProgress(this.scrollTarget); this.render();
    }
    if (this.pointer.matches) this.wake();
  };
  JourneyScene.prototype.setProgress = function (progress) {
    this.progress = this.motion.matches ? 0 : progress;
    const position = this.progress * 2;
    this.cities.forEach((city, i) => {
      let weight = Math.max(0, 1 - Math.abs(position - i));
      weight = weight * weight * (3 - 2 * weight);
      city.material.uniforms.uOpacity.value = weight;
      city.material.depthWrite = false;
      city.group.visible = weight > .001; city.group.position.x = (i - position) * 1.4;
    });
  };
  JourneyScene.prototype.listen = function (target, name, fn, options) {
    target.addEventListener(name, fn, options); this.cleanups.push(() => target.removeEventListener(name, fn, options));
  };
  JourneyScene.prototype.bind = function () {
    this.listen(window, 'resize', () => this.resize(), { passive: true });
    this.listen(window, 'scroll', () => this.updateScroll(), { passive: true });
    this.listen(window, 'xettl:themechange', () => this.theme());
    this.listen(document, 'visibilitychange', () => this.sync());
    this.listen(window, 'xettl:overlaychange', event => { this.overlayOpen = !!event.detail.open; this.resetLight(); this.sync(); if (!this.overlayOpen) this.wake(); });
    this.listen(window, 'pagehide', event => { if (!event.persisted) this.dispose(); });
    this.listen(this.motion, 'change', () => { this.resetLight(); this.setProgress(this.motion.matches ? 0 : this.scrollTarget); this.resize(); this.sync(); });
    this.listen(this.pointer, 'change', () => { this.resetLight(); this.resize(); this.sync(); });
    this.listen(this.stage, 'pointermove', event => {
      if (!this.pointer.matches || event.pointerType === 'touch' || this.motion.matches || this.paused || this.overlayOpen) return;
      this.target.x = Math.max(0, Math.min(1, event.clientX / this.container.clientWidth));
      this.target.y = Math.max(0, Math.min(1, 1 - event.clientY / this.container.clientHeight));
      this.glowTarget = 1; this.wake();
    }, { passive: true });
    this.listen(this.stage, 'pointerleave', () => { this.glowTarget = 0; this.wake(); });
    this.listen(this.canvas, 'webglcontextlost', event => {
      event.preventDefault(); this.contextLost = true; this.container.classList.remove('journey-ready'); this.sync();
    });
    this.listen(this.canvas, 'webglcontextrestored', () => {
      this.contextLost = false; this.container.classList.add('journey-ready'); this.theme(); this.wake();
    });
    // This backdrop remains visible behind every section; only hidden documents/overlays suspend it.
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.container);
      this.contentObserver = new ResizeObserver(() => this.updateScroll()); this.contentObserver.observe(document.querySelector('main'));
    }
  };
  JourneyScene.prototype.resetLight = function () {
    this.glow = this.glowTarget = 0; this.shared.uGlow.value = 0; this.velocity.x = this.velocity.y = 0;
    this.trail.forEach(point => point.set(.5, .5));
  };
  JourneyScene.prototype.resize = function () {
    if (!this.renderer || this.disposed) return;
    const width = this.container.clientWidth || 1200, height = this.container.clientHeight || 760;
    const worldWidth = width < 600 ? 28 : 38, halfHeight = worldWidth * height / width / 2;
    this.camera.left = -worldWidth / 2; this.camera.right = worldWidth / 2;
    this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.position.set(9, 10, 32); this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
    this.group.position.y = -halfHeight * .34; this.actorCeiling = halfHeight * 1.02;
    this.shared.uAspect.value = width / height;
    // Native CSS-pixel resolution keeps the miniature architecture crisp, not pixelated.
    this.renderer.setSize(width, height, false);
    this.actorDelta = 0; this.updateTravel(); this.updateScroll(); this.render();
  };
  JourneyScene.prototype.theme = function () {
    const dark = document.documentElement.dataset.theme === 'dark';
    this.shared.uBase.value.set(dark ? '#7896b3' : '#d6dde1').convertSRGBToLinear();
    this.shared.uBlue.value.set(dark ? '#72a9ff' : '#1266f1').convertSRGBToLinear();
    this.shared.uDark.value = dark ? 1 : 0; this.render();
  };
  JourneyScene.prototype.render = function () {
    if (!this.disposed && !this.contextLost && this.renderer) this.renderer.render(this.scene, this.camera);
  };
  JourneyScene.prototype.sync = function () {
    cancelAnimationFrame(this.frame); this.frame = null; this.lastFrame = null;
    if (this.disposed) return;
    const staticMode = this.motion.matches || !this.pointer.matches;
    this.render();
    if (staticMode || this.paused || document.hidden || this.contextLost || this.overlayOpen) return;
    if (performance.now() > Math.max(this.introUntil, this.inputUntil)) return;
    const loop = now => {
      if (this.motion.matches || !this.pointer.matches || document.hidden) { this.sync(); return; }
      const delta = this.lastFrame === null ? 0 : Math.min((now - this.lastFrame) / 1000, .05);
      if (now > Math.max(this.introUntil, this.inputUntil)) {
        this.setProgress(this.scrollTarget); this.glow = this.glowTarget = 0; this.shared.uGlow.value = 0;
        this.render(); this.frame = null; this.lastFrame = null; return;
      }
      if (now > this.inputUntil - 500) this.glowTarget = 0;
      this.lastFrame = now; this.elapsed += delta; this.actorDelta = delta; this.updateTravel();
      // Time-based damping keeps abrupt wheel/touchpad scrolls from snapping between cities.
      const next = this.progress + (this.scrollTarget - this.progress) * (1 - Math.exp(-delta * 6));
      this.setProgress(Math.abs(next - this.scrollTarget) < .0001 ? this.scrollTarget : next);
      // Physical pointer follow: mass 1, stiffness 100, damping 10; substeps keep low-FPS motion stable.
      const steps = Math.max(1, Math.ceil(delta / .016)), dt = delta / steps;
      for (let i = 0; i < steps; i++) for (const axis of ['x', 'y']) {
        this.velocity[axis] += ((this.target[axis] - this.offset[axis]) * 100 - this.velocity[axis] * 10) * dt;
        this.offset[axis] += this.velocity[axis] * dt;
      }
      this.trail[0].set(this.offset.x, this.offset.y);
      for (let i = 1; i < this.trail.length; i++) this.trail[i].lerp(this.trail[i - 1], 1 - Math.exp(-delta * 9));
      this.glow += (this.glowTarget - this.glow) * (1 - Math.exp(-delta * 5));
      this.shared.uGlow.value = this.glow; this.render(); this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  };
  JourneyScene.prototype.wake = function () {
    if (!this.initialized || this.disposed || this.motion.matches || !this.pointer.matches || this.overlayOpen) return;
    this.inputUntil = performance.now() + 1200;
    if (!this.frame) this.sync();
  };
  JourneyScene.prototype.dispose = function () {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.frame = null;
    this.cleanups.forEach(cleanup => cleanup());
    if (this.observer) this.observer.disconnect(); if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.contentObserver) this.contentObserver.disconnect();
    const geometries = new Set();
    if (this.scene) this.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
    geometries.forEach(geometry => geometry.dispose()); this.materials.forEach(material => material.dispose());
    if (this.life) this.life.dispose();
    if (this.renderer) this.renderer.dispose();
  };
  window.XettlSpatialScene = { init: options => new JourneyScene(options) };
})();
