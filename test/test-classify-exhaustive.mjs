/**
 * Exhaustive 3x3 verification of classifyPixels against per-pixel inline logic.
 * Checks corners, radii, innerFillets, and diagBridges for all 511 non-empty masks.
 */
import { key } from '../pixel-paths.mjs';
import { classifyPixels } from '../pixel-classify.mjs';

const combos = [
  { ro: 0.5, ri: 0.45, connectDiagonals: 0, fullLCorners: false, skipCheckerLCorners: false },
  { ro: 0.5, ri: 0.45, connectDiagonals: 0, fullLCorners: true, skipCheckerLCorners: false },
  { ro: 0.5, ri: 0.45, connectDiagonals: 5, fullLCorners: true, skipCheckerLCorners: true },
];

let totalPatterns = 0, totalFails = 0;

for (const opts of combos) {
  const { ro, ri, connectDiagonals: cd, fullLCorners: flc, skipCheckerLCorners: scl } = opts;
  let fails = 0;

  for (let mask = 1; mask < 512; mask++) {
    const allPixels = new Set();
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        if (mask & (1 << (r * 3 + c))) allPixels.add(key(c, r));

    const pixelMap = classifyPixels(allPixels, allPixels, opts);

    for (const k of allPixels) {
      const [x, y] = k.split(',').map(Number);
      const info = pixelMap.get(k);

      const hasL = allPixels.has(key(x-1,y)), hasR = allPixels.has(key(x+1,y));
      const hasU = allPixels.has(key(x,y-1)), hasD = allPixels.has(key(x,y+1));
      const hasTL = allPixels.has(key(x-1,y-1)), hasTR = allPixels.has(key(x+1,y-1));
      const hasBR = allPixels.has(key(x+1,y+1)), hasBL = allPixels.has(key(x-1,y+1));

      const remCurrent = (hasL?1:0)+(hasR?1:0)+(hasU?1:0)+(hasD?1:0);
      let diagTL=false,diagTR=false,diagBR=false,diagBL=false;
      if (cd > 0) {
        const threshold=cd-1, tFloor=Math.floor(threshold), frac=threshold-tFloor;
        function sc(remOther,vx,vy) {
          const sum=remCurrent+remOther;
          if(sum<=tFloor)return true;
          if(frac>0&&sum===tFloor+1)return((vx*3+vy*7)%4)<(frac*4);
          return false;
        }
        if(!hasL&&!hasU&&hasTL){const rem=(allPixels.has(key(x-2,y-1))?1:0)+(allPixels.has(key(x-1,y-2))?1:0);diagTL=sc(rem,x,y);}
        if(!hasR&&!hasU&&hasTR){const rem=(allPixels.has(key(x+2,y-1))?1:0)+(allPixels.has(key(x+1,y-2))?1:0);diagTR=sc(rem,x+1,y);}
        if(!hasR&&!hasD&&hasBR){const rem=(allPixels.has(key(x+2,y+1))?1:0)+(allPixels.has(key(x+1,y+2))?1:0);diagBR=sc(rem,x+1,y+1);}
        if(!hasL&&!hasD&&hasBL){const rem=(allPixels.has(key(x-2,y+1))?1:0)+(allPixels.has(key(x-1,y+2))?1:0);diagBL=sc(rem,x,y+1);}
      }

      const tl=ro>0&&!hasL&&!hasU&&!diagTL;
      const tr=ro>0&&!hasR&&!hasU&&!diagTR;
      const br=ro>0&&!hasR&&!hasD&&!diagBR;
      const bl=ro>0&&!hasL&&!hasD&&!diagBL;

      let tlR=ro,trR=ro,brR=ro,blR=ro;
      if(flc&&ro>0){
        if(tl&&hasR&&hasD&&!(scl&&hasTL))tlR=1;
        if(tr&&hasL&&hasD&&!(scl&&hasTR))trR=1;
        if(br&&hasL&&hasU&&!(scl&&hasBR))brR=1;
        if(bl&&hasR&&hasU&&!(scl&&hasBL))blR=1;
      }

      const fTL=hasL&&hasU&&!hasTL, fTR=hasR&&hasU&&!hasTR;
      const fBR=hasR&&hasD&&!hasBR, fBL=hasL&&hasD&&!hasBL;

      if(info.corners.tl.rounded!==tl||info.corners.tl.radius!==tlR||
         info.corners.tr.rounded!==tr||info.corners.tr.radius!==trR||
         info.corners.br.rounded!==br||info.corners.br.radius!==brR||
         info.corners.bl.rounded!==bl||info.corners.bl.radius!==blR||
         info.innerFillets.tl!==fTL||info.innerFillets.tr!==fTR||
         info.innerFillets.br!==fBR||info.innerFillets.bl!==fBL||
         info.diagBridges.tl!==diagTL||info.diagBridges.tr!==diagTR||
         info.diagBridges.br!==diagBR||info.diagBridges.bl!==diagBL) {
        fails++;
      }
    }
    totalPatterns++;
  }

  const label = `ro=${ro} ri=${ri} cd=${cd} flc=${flc} scl=${scl}`;
  if (fails === 0) console.log(`PASS ${label} (${511} patterns)`);
  else { console.log(`FAIL ${label}: ${fails} pixel mismatches`); totalFails += fails; }
}

console.log(`\n${totalPatterns} total pattern-checks, ${totalFails} failures`);
if (totalFails > 0) process.exit(1);
