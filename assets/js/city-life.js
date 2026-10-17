/* Fictional miniature street life. No customer data, random feed, or captured input. */
(function () {
  'use strict';
  window.XettlCityLife = function (T, material) {
    const mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), material, 2400);
    mesh.frustumCulled = false;
    const object = new T.Object3D(), projected = new T.Vector3();
    const actors = Array.from({ length: 12 }, (_, i) => ({ x: i * 4.2 - 24, speed: .48 + i % 4 * .12, direction: i % 2 ? -1 : 1 }));
    const people = Array.from({ length: 18 }, (_, i) => ({ x: i * 2.8 - 24, speed: .075 + i % 3 * .025, direction: i % 2 ? -1 : 1 }));
    const blue = new T.Color('#5286b9').convertSRGBToLinear(), cream = new T.Color('#d4c6a7').convertSRGBToLinear();
    const dark = new T.Color('#617380').convertSRGBToLinear(), pale = new T.Color('#d6dfdf').convertSRGBToLinear();
    const details = new T.Group(), resources = [];
    const rounds = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), material, 180);
    rounds.frustumCulled = false; details.add(rounds);
    const glass = new T.Color('#739dc3').convertSRGBToLinear(), stone = new T.Color('#d1d6d7').convertSRGBToLinear();
    const colors = {};
    function tint(hex) { return colors[hex] || (colors[hex] = new T.Color(hex).convertSRGBToLinear()); }
    const stores = [
      { x: -14, name: 'PARKSIDE DINER', type: 'restaurant', amount: '−$16', method: 'phone', width: 4.6, height: 3.1, signY: 1.75, signBg: '#743f3d', signInk: '#fff1d6' },
      { x: -7, name: 'PETAL & STEM', type: 'florist', amount: '−$24', method: 'cash', width: 3.8, height: 2.35, signY: 1.9, signBg: '#cfd9c2', signInk: '#304b3b' },
      { x: 0, name: 'CORNER MARKET', type: 'grocery', amount: '−$18', method: 'card', width: 4.8, height: 3.8, signY: 1.75, signBg: '#e5d7b1', signInk: '#4c573c' },
      { x: 7, name: 'BANK', type: 'bank', amount: '+$120', method: 'deposit', width: 4.3, height: 2.8, signY: 2.4, signBg: '#c3ccd4', signInk: '#193a58' },
      { x: 14, name: 'THE BLUE HOUR', type: 'bar', amount: '−$12', method: 'phone', width: 3.9, height: 3.5, signY: 1.9, signBg: '#233a50', signInk: '#e3ca95' }
    ];
    function label(text, width, amount, store) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = amount ? '#eef7ff' : store.signBg;
      ctx.beginPath(); ctx.roundRect(4, 8, 504, 112, amount ? 40 : 8); ctx.fill();
      ctx.fillStyle = amount ? '#164e9e' : store.signInk;
      ctx.font = '600 ' + (amount ? 80 : 48) + 'px Geist, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 67);
      const texture = new T.CanvasTexture(canvas); texture.encoding = T.sRGBEncoding;
      const labelMaterial = new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
      const sprite = new T.Sprite(labelMaterial); sprite.scale.set(width, width / 4, 1); sprite.renderOrder = 5;
      resources.push(texture, labelMaterial); details.add(sprite); return sprite;
    }
    stores.forEach(store => {
      store.sign = label(store.name, store.width * .8, false, store); store.sign.position.set(store.x, store.signY, 3.16);
      store.popup = label(store.amount, 2, true); store.popup.visible = false;
    });
    let index = 0, roundIndex = 0;
    function box(x, y, z, w, h, d, color, tilt) {
      object.position.set(x, y, z); object.scale.set(w, h, d); object.rotation.set(tilt || 0, 0, 0);
      object.updateMatrix(); mesh.setMatrixAt(index, object.matrix); mesh.setColorAt(index++, color);
    }
    function orb(x, y, z, w, h, d, color) {
      object.position.set(x,y,z); object.scale.set(w,h,d); object.rotation.set(0,0,0); object.updateMatrix();
      rounds.setMatrixAt(roundIndex, object.matrix); rounds.setColorAt(roundIndex++, color);
    }
    this.mesh = mesh; this.details = details; this.stores = stores; this.actors = actors; this.people = people; this.lastInteraction = false;
    this.planes = [{ x: -12, y: 0 }, { x: 9, y: 0 }]; this.activeTransactions = 0;
    this.dispose = function () { resources.forEach(resource => resource.dispose()); };
    this.update = function (time, delta, camera, parent, pointer, active, ceiling) {
      index = 0; roundIndex = 0; this.lastInteraction = false;
      function near(x, y, z) {
        if (!active) return 0;
        projected.set(x, y, z); parent.localToWorld(projected); projected.project(camera);
        const dx = (projected.x * .5 + .5 - pointer.x) * camera.right / camera.top;
        const dy = projected.y * .5 + .5 - pointer.y;
        return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / .1);
      }
      actors.forEach((car, i) => {
        const z = car.direction > 0 ? 4.65 : 5.55, proximity = near(car.x, .2, z);
        car.x += delta * car.speed * car.direction * (1 - proximity * .75);
        if (car.x > 27) car.x = -27; if (car.x < -27) car.x = 27;
        if (proximity > .1) this.lastInteraction = true;
        const paint = i % 4 === 0 ? cream : i % 3 === 0 ? pale : blue;
        const length = i === 3 || i === 8 ? 1.05 : .62;
        box(car.x, .17, z, length, .19, .3, paint);
        box(car.x, .31, z, length * .52, .15, .25, pale);
        box(car.x, .3, z + .128, length * .35, .075, .012, dark);
        for (const side of [-1, 1]) {
          box(car.x - length * .3, .09, z + side * .16, .13, .13, .045, dark);
          box(car.x + length * .3, .09, z + side * .16, .13, .13, .045, dark);
        }
        box(car.x + car.direction * length * .5, .19, z, .025, .05, .23, cream);
      });
      people.forEach((person, i) => {
        const z = i % 2 ? 3.75 : 6.4, proximity = near(person.x, .35, z);
        person.x += delta * person.speed * person.direction;
        if (person.x > 25) person.x = -25; if (person.x < -25) person.x = 25;
        if (proximity > .15) this.lastInteraction = true;
        const stride = Math.sin(time * 3.2 + i) * .035;
        box(person.x, .39, z, .105, .105, .1, cream);
        box(person.x, .25, z, .12, .18, .09, i % 3 ? blue : pale);
        box(person.x - .035, .1, z + stride, .045, .17, .045, dark);
        box(person.x + .035, .1, z - stride, .045, .17, .045, dark);
        box(person.x - .09, .25, z - stride, .045, .14, .045, cream);
        box(person.x + .09, .25 + proximity * .16, z + stride, .045, .14, .045, cream, proximity * -.7);
      });
      this.activeTransactions = 0;
      stores.forEach((store, i) => {
        // Distinct neighborhood architecture, not one repeated shop with a new name.
        {
        const x = store.x, w = store.width, h = store.height;
        const wall = tint(['#b7c3cc','#9bad95','#c4ad8e','#bec6ca','#566d81'][i]);
        box(x,h/2,2,w,h,2.05,wall);
        box(x,h+.06,2,w+.18,.12,2.18,stone);
        box(x,.14,3.1,w+.12,.22,.35,stone);
        if (store.type === 'restaurant') {
          // Chrome-edged diner, burgundy fascia, ribbon windows and pavement tables.
          box(x,.85,3.04,w-.3,.95,.08,glass);
          box(x,.35,3.1,w-.16,.28,.1,tint('#895c57'));
          box(x,1.46,3.25,w+.2,.13,.65,pale);
          for(let j=0;j<7;j++) box(x-w/2+.3+j*.67,.87,3.12,.035,1.04,.09,pale);
          box(x,1.87,3.04,w,.46,.07,tint('#895c57'));
          for(const dx of [-1.35,1.35]) {
            box(x+dx,2.6,3.04,.85,.55,.06,glass);
            box(x+dx,2.6,3.1,.035,.55,.04,cream);
            box(x+dx,.35,3.85,.045,.65,.045,dark);
            orb(x+dx,.68,3.85,.35,.035,.35,cream);
            for(const side of [-1,1]) box(x+dx+side*.42,.28,3.85,.22,.07,.22,tint('#895c57'));
          }
          box(x+.8,h+.22,1.8,.8,.3,.55,dark);
        } else if (store.type === 'florist') {
          // Low sage shop, glass door, sloped canvas canopy, planters and individual blooms.
          box(x,.85,3.05,w-.35,1.25,.055,glass);
          box(x+.7,.7,3.12,.62,1.35,.06,dark);
          box(x,1.55,3.39,w+.25,.09,1.02,tint('#879f7e'),-.14);
          for(const dx of [-1.35,-.75,-.15,1.35]) {
            box(x+dx,.2,3.62,.4,.35,.4,tint('#9d8066'));
            for(let bloom=0;bloom<3;bloom++) {
              const bx=x+dx+(bloom-1)*.12, by=.64+(bloom%2)*.12;
              box(bx,.43,3.65,.025,.4,.025,tint('#58775a'));
              orb(bx,by,3.65,.12,.1,.1,tint(bloom%2?'#e9c4b2':'#eadbb2'));
            }
          }
          box(x,h+.16,2.1,w-.3,.2,1.5,tint('#89947c'));
        } else if (store.type === 'grocery') {
          // Brick corner grocery, striped awning, stacked produce crates, apartments above.
          box(x,.85,3.05,w-.3,1.15,.07,glass);
          box(x-1.6,.67,3.12,.68,1.3,.08,dark);
          for(let stripe=0;stripe<12;stripe++) box(x-w/2+.2+stripe*.4,1.48,3.35,.4,.11,.83,stripe%2?cream:tint('#718767'),-.1);
          for(let crate=0;crate<4;crate++) {
            const cx=x-.6+crate*.64;
            box(cx,.28,3.65,.56,.4,.48,tint('#9d8066'));
            for(let fruit=0;fruit<3;fruit++) orb(cx-.15+fruit*.15,.53,3.65,.09,.09,.09,tint(crate%2?'#b5b475':'#b78d78'));
          }
          for(const fy of [2.35,3.18]) for(const dx of [-1.65,-.55,.55,1.65]) {
            box(x+dx,fy,3.06,.61,.55,.06,dark);
            box(x+dx,fy+.31,3.12,.75,.07,.16,cream);
          }
          box(x+.7,2.8,3.3,.06,1.5,.06,dark);
          for(let rung=0;rung<6;rung++) box(x+.7,2.12+rung*.24,3.3,.65,.035,.08,dark);
        } else if (store.type === 'bank') {
          // Stone banking hall with columns, recessed doors, broad steps and an ATM.
          box(x,1.25,3.05,w-.7,1.8,.06,glass);
          for(const dx of [-1.7,-.85,.85,1.7]) {
            box(x+dx,1.2,3.22,.17,2.05,.24,pale);
            box(x+dx,2.18,3.22,.34,.13,.35,cream);
          }
          box(x,2.56,3.15,w+.12,.45,.3,stone);
          for(let stair=0;stair<3;stair++) box(x,.08+stair*.07,3.4-stair*.13,w-.3,.08,.6-stair*.13,stone);
          box(x+1.4,.67,3.35,.4,.92,.3,dark);
          box(x+1.4,.85,3.52,.27,.23,.015,glass);
          box(x+1.4,.55,3.52,.25,.035,.02,pale);
        } else {
          // Narrow midnight-blue bar, brass pilasters, warm windows and a roof terrace.
          box(x,.83,3.06,w-.4,1.3,.08,tint('#917d60'));
          for(const dx of [-1.55,-.6,.6,1.55]) box(x+dx,1.1,3.16,.1,2.1,.12,tint('#b9a47d'));
          box(x,.77,3.14,.52,1.5,.07,dark);
          for(const dx of [-1,1]) {
            box(x+dx,.85,3.16,.64,.85,.06,tint('#ad9a77'));
            orb(x+dx,1.36,3.18,.34,.34,.055,tint('#ad9a77'));
            box(x+dx,2.75,3.07,.7,.7,.055,glass);
          }
          box(x,2.2,3.14,w,.12,.2,tint('#b9a47d'));
          for(let rail=0;rail<8;rail++) box(x-w/2+.2+rail*.5,h+.3,3.03,.035,.5,.04,dark);
          box(x,h+.55,3.03,w,.04,.04,dark);
        }
        // The infill is a narrow townhouse, giving the block a continuous street wall.
        const infillX=x+2.85, infillH=2.6+i%3*.65;
        box(infillX,infillH/2,2,1.05,infillH,1.9,tint(i%2?'#a49384':'#9daeb8'));
        for(let floor=.7;floor<infillH;floor+=.7) box(infillX,floor,2.97,.5,.4,.04,dark);
        box(infillX,infillH+.05,2,1.2,.12,2,cream);
        }
        // Shopkeeper and customer, each built from the same tiny voxel vocabulary.
        box(store.x - .43, .9, 2.96, .14, .14, .12, cream);
        box(store.x - .43, .7, 2.96, .19, .25, .12, blue);
        const phase = (time + i * 2.7) % 15;
        const paying = phase >= 4 && phase < 8;
        const approach = phase < 4 ? 1 - phase / 4 : phase < 8 ? 0 : Math.min(1, (phase - 8) / 4);
        const x = store.x - .3 + approach * 2.1, z = 3.62;
        const proximity = near(x, .5, z);
        if (proximity > .15) this.lastInteraction = true;
        const stride = paying ? 0 : Math.sin(time * 4 + i) * .05;
        box(x, .62, z, .15, .15, .14, cream);
        box(x, .41, z, .19, .27, .13, i % 2 ? pale : blue);
        box(x - .06, .16, z + stride, .07, .25, .07, dark);
        box(x + .06, .16, z - stride, .07, .25, .07, dark);
        box(x - .14, paying ? .48 : .4, z - (paying ? .14 : 0), .065, .23, .065, cream, paying ? -.8 : 0);
        box(x + .14, .42 + proximity * .12, z, .065, .23, .065, cream, -proximity * .7);
        if (paying) {
          const cash = store.method === 'cash' || store.method === 'deposit';
          box(x - .14, .55, z - .24, cash ? .2 : .1, store.method === 'phone' ? .17 : .035, .055, cash ? cream : dark);
          if (store.method === 'phone') box(x - .14, .55, z - .205, .065, .11, .012, pale);
          else if (store.method === 'card') box(x - .14, .575, z - .24, .08, .012, .045, blue);
        }
        const receipt = phase - 6;
        store.popup.visible = time > 0 && receipt >= 0 && receipt < 2.5;
        if (store.popup.visible) {
          this.activeTransactions++;
          store.popup.position.set(store.x - .25, 2 + receipt * .35, 3.7);
          store.popup.material.opacity = Math.min(1, receipt * 5) * Math.min(1, (2.5 - receipt) * 2);
        }
      });
      for (let i = 0; i < 2; i++) {
        const direction = i ? -1 : 1, start = i ? 20 : 17;
        const x = (((time * (.65 + i * .13) + start) % 58) - 29) * direction;
        const y = ceiling * (i ? 1.02 : .77), z = -2 - i * 4, proximity = near(x, y, z);
        this.planes[i].x = x; this.planes[i].y = y;
        if (proximity > .1) this.lastInteraction = true;
        box(x, y, z, 2.1, .16, .18, blue);
        box(x - direction * .13, y, z, .5, .08, 1.8, pale, proximity * .2);
        box(x - direction * .85, y + .19, z, .3, .44, .08, blue);
        box(x - direction * .8, y, z, .4, .07, .75, pale);
        box(x + direction * .72, y + .02, z, .22, .09, .19, dark);
      }
      mesh.count = index; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      rounds.count = roundIndex; rounds.instanceMatrix.needsUpdate = true; if (rounds.instanceColor) rounds.instanceColor.needsUpdate = true;
    };
  };
})();
