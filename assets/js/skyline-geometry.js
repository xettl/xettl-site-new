/* Original, illustrative city miniatures. Geometry only; no downloaded models or map data. */
(function () {
  'use strict';
  window.XettlSkylineGeometry = {
    build: function (T, makeMaterial) {
      const names = ['New York', 'Chicago', 'San Francisco'];
      return names.map(function (name, cityIndex) {
        const group = new T.Group(); group.name = name;
        const material = makeMaterial(0);
        const boxes = [], beams = [], curves = [];
        let seed = 421 + cityIndex * 817;
        function random() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
        const palette = [0xa9bdc9, 0xc2cbd0, 0xb5b8ac, 0x899eae, 0xa7b5b9, 0x7d929c];
        function box(x, y, z, w, h, d, tint) { boxes.push([x, y + h / 2, z, w, h, d, tint || palette[Math.floor(random() * palette.length)]]); }
        function cylinder(x, y, z, top, bottom, height, sides) {
          curves.push([x,y,z,top,bottom,height,sides <= 4 ? 4 : Math.max(20,sides || 24)]);
        }
        function beam(a, b, radius) {
          beams.push([a, b, radius]);
        }
        // A lower middle leaves a deliberate opening for the centered headline.
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 31; col++) {
            const x = -19 + col * 1.27 + (random() - .5) * .35;
            const flank = Math.min(1, Math.abs(x) / 7);
            const height = .65 + random() * (1.1 + flank * 4.2);
            const width = .55 + random() * .55;
            const z = -2.8 - row * 1.4;
            box(x, 0, z, width, height, .7 + random() * .6);
            if (col % 4 === 0) box(x, height, z, width * .55, .2 + random() * .5, .5);
            // Cornices, floor ledges, rooftop plant and street-level podiums add scale.
            for (let y = .48; y < height; y += .48) box(x, y, z, width + .045, .035, .86, 0xbdc9ce);
            box(x, height, z, width + .07, .09, .9, 0x9aaab3);
            box(x + width * .18, height + .09, z, width * .24, .14, .25, 0x728893);
            if (col % 3 === 0) box(x, 0, z + .2, width * 1.3, .45, 1.2, 0xc7c6b9);
          }
        }
        if (cityIndex === 0) {
          // Empire State: setbacks, crown and spire. One World: tapered glass and antenna.
          box(-10.5, 0, .1, 2.1, 5.7, 1.5);
          box(-10.5, 5.7, .1, 1.65, 1.2, 1.25);
          box(-10.5, 6.9, .1, 1.15, 1.25, .95);
          box(-10.5, 8.15, .1, .65, .7, .6);
          cylinder(-10.5, 8.85, .1, .045, .11, 1.5, 8);
          cylinder(10.8, 0, -.2, .62, 1.15, 8.8, 4);
          cylinder(10.8, 8.8, -.2, .025, .065, 1.65, 8);
          box(-6.5, 0, .6, 1.35, 5.9, 1.2);
          for (let i = 0; i < 4; i++) cylinder(-6.5, 5.9 + i * .32, .6, .48 - i * .09, .64 - i * .1, .42, 8);
          cylinder(-6.5, 7.15, .6, 0, .18, 1.1, 8);
          box(15, 0, -1, 1.3, 6.6, 1.1);
          for (let i = 0; i < 5; i++) box(15, 6.6 + i * .2, -1, 1.1 - i * .14, .22, .9 - i * .1);
        } else if (cityIndex === 1) {
          // Willis Tower's bundled tubes and the tapered, cross-braced Hancock silhouette.
          for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
            const h = [6.2, 7.9, 6.8, 7.7, 9.4, 8.8, 5.7, 8.7, 7.3][x * 3 + z];
            box(-10.5 + (x - 1) * .64, 0, (z - 1) * .64, .65, h, .65);
          }
          cylinder(-10.8, 9.4, .1, .025, .05, 1.4, 6);
          cylinder(-10.1, 9.4, .1, .025, .05, 1.25, 6);
          cylinder(10.7, 0, .3, .67, 1.1, 8.2, 4);
          for (let i = 0; i < 4; i++) {
            const left = 9.9 + i * .045, right = 11.5 - i * .045, y = i * 1.9;
            beam([left, y, 1.06], [right, y + 1.9, 1.06], .035);
            beam([right, y, 1.06], [left, y + 1.9, 1.06], .035);
          }
          cylinder(10.3, 8.2, .3, .02, .04, 1.35, 6);
          cylinder(11.1, 8.2, .3, .02, .04, 1.35, 6);
          cylinder(6.8, 0, -1.4, .65, .82, 5.8, 20);
          cylinder(15, 0, -2, .62, .85, 6.3, 20);
        } else {
          // Transamerica Pyramid, a rounded Salesforce-like tower and a suspension bridge.
          cylinder(6.6, 0, .2, 0, 1.05, 7.4, 4);
          box(6.6, 0, .2, 1.1, 1.8, 1.1);
          cylinder(10.9, 0, -.7, .72, .9, 7.4, 24);
          for (let layer = 0; layer < 6; layer++) {
            const radius = .72 * Math.sqrt(1 - Math.pow((layer + .5) / 6, 2));
            cylinder(10.9, 7.4 + layer * .12, -.7, radius, radius, .12, 16);
          }
          for (const x of [-14, -6]) {
            box(x - .3, 0, 1, .18, 5.8, .3); box(x + .3, 0, 1, .18, 5.8, .3);
            box(x, 4.95, 1, .8, .15, .3); box(x, 3.8, 1, .8, .15, .3);
          }
          box(-10, 1.75, 1, 17, .16, .65);
          let previous = null;
          for (let i = 0; i <= 48; i++) {
            const x = -18 + i / 3;
            const y = x < -14 ? 2 + 3.65 * (x + 18) / 4 : x > -6 ? 5.65 - 3.65 * (x + 6) / 4 : 2.25 + 3.4 * Math.pow((x + 10) / 4, 2);
            const point = [x, y, 1.18];
            if (previous) beam(previous, point, .028);
            if (i % 2 === 0) beam([x, 1.9, 1.18], point, .018);
            previous = point;
          }
        }
        // Roads, sidewalks, crossing stripes, pocket trees and lamps belong to each miniature.
        box(0, -.14, 5.1, 48, .13, 2.3, 0x71868d);
        box(0, -.12, 3.65, 48, .12, .55, 0xbac6c7);
        box(0, -.12, 6.55, 48, .12, .55, 0xbac6c7);
        for (let x = -23; x < 24; x += 1.3) box(x, .005, 5.1, .55, .012, .045, 0xd9cfb2);
        for (const crossing of [-13, 0, 13]) for (let stripe = 0; stripe < 6; stripe++) box(crossing, .01, 4.15 + stripe * .34, .85, .012, .14, 0xe0e4dc);
        for (let x = -22; x < 24; x += 2.8) {
          box(x, 0, 3.5, .055, .75, .055, 0x778d97);
          box(x + .11, .72, 3.5, .28, .065, .09, 0xd0d8ca);
          box(x + 1.1, 0, 6.65, .07, .35, .07, 0x9f9b81);
          box(x + 1.1, .32, 6.65, .38, .38, .36, 0x97afa1);
          box(x + 1.1, .66, 6.65, .25, .16, .25, 0xa4b6a2);
        }
        const blocks = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), material, boxes.length);
        const transform = new T.Object3D();
        boxes.forEach(function (b, i) {
          transform.position.set(b[0], b[1], b[2]); transform.scale.set(b[3], b[4], b[5]);
          transform.updateMatrix(); blocks.setMatrixAt(i, transform.matrix);
          blocks.setColorAt(i, new T.Color(b[6]).convertSRGBToLinear());
        });
        blocks.instanceMatrix.needsUpdate = true; blocks.frustumCulled = false; group.add(blocks);
        // Smooth landmark profiles share one merged draw instead of stair-stepped voxel courses.
        if (curves.length) {
          const positions = [], normals = [], colors = [], shade = new T.Color(0xa1b6c5).convertSRGBToLinear();
          curves.forEach(c => {
            const indexed = new T.CylinderGeometry(c[3],c[4],c[5],c[6]);
            const geometry = indexed.toNonIndexed(); indexed.dispose();
            geometry.translate(c[0],c[1]+c[5]/2,c[2]);
            positions.push(...geometry.attributes.position.array); normals.push(...geometry.attributes.normal.array);
            for(let v=0;v<geometry.attributes.position.count;v++) colors.push(shade.r,shade.g,shade.b);
            geometry.dispose();
          });
          const geometry = new T.BufferGeometry();
          geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
          geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
          geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
          // Non-instanced color attributes are handled explicitly by the shared scene shader.
          const smooth = new T.Mesh(geometry,material); smooth.frustumCulled = false; group.add(smooth);
        }
        if (beams.length) {
          const cables = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 6), material, beams.length);
          const up = new T.Vector3(0, 1, 0);
          beams.forEach(function (beam, i) {
            const start = new T.Vector3(...beam[0]), end = new T.Vector3(...beam[1]);
            transform.position.copy(start).add(end).multiplyScalar(.5);
            transform.scale.set(beam[2], start.distanceTo(end), beam[2]);
            transform.quaternion.setFromUnitVectors(up, end.sub(start).normalize());
            transform.updateMatrix(); cables.setMatrixAt(i, transform.matrix);
            cables.setColorAt(i, new T.Color(1, 1, 1));
          });
          cables.instanceMatrix.needsUpdate = true; cables.frustumCulled = false; group.add(cables);
        }
        return { name, group, material, blocks };
      });
    }
  };
})();
