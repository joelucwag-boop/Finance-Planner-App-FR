import { C, fmt, M, Y, BASE, SPEND_CAT, moName } from '../constants.js';

const SankeyChart = ({year}) => {
  const yd = Y.find(d => d.yr === year);
  if (!yd) return null;
  const sc = SPEND_CAT[year];
  const monthsThisYear = M.filter(m => m.yr === year);
  const annGross = monthsThisYear.reduce((s,m) => s + m.gross, 0) || yd.gross;
  const annTax = monthsThisYear.reduce((s,m) => s + m.tax, 0) || yd.tax;
  const annTake = monthsThisYear.reduce((s,m) => s + m.take, 0) || yd.take;
  const annLeft = yd.left;
  const age = year - (BASE.birthYear || 2003);
  const isMarried = (BASE.weddingEnabled===true||BASE.weddingEnabled==="true") && year >= (BASE.startYear||2026) + (BASE.weddingYear||2);

  // ── Income source estimates ──
  const hasPension = age >= 60;
  const hasSS = age >= 67;
  let estWife = (BASE.partnerEnabled===true||BASE.partnerEnabled==="true") && isMarried && age <= 67 ? Math.min(annGross * 0.3, annGross) : 0;
  let estGuard = (BASE.guardEnabled===true||BASE.guardEnabled==="true") && age < 60 ? Math.min(annGross * 0.06, 12000) : 0;
  let estPension = hasPension ? 1200 * 12 * Math.pow(1.025, age - 60) : 0;
  let estSS = hasSS ? (3500 + (isMarried ? 1500 : 0)) * 12 : 0;
  let estYou = Math.max(0, annGross - estWife - estGuard - estPension - estSS);

  // ── Spending categories ──
  const cats = [];
  if (sc) {
    if (sc.housing>0) cats.push({label:"Housing",val:sc.housing,color:"#a78bfa"});
    if (sc.health>0) cats.push({label:"Healthcare",val:sc.health,color:"#f472b6"});
    if (sc.kids>0) cats.push({label:"Kids",val:sc.kids,color:"#fbbf24"});
    if (sc.car>0) cats.push({label:"Cars",val:sc.car,color:"#fb923c"});
    if (sc.bills>0) cats.push({label:"Bills & Living",val:sc.bills,color:"#38bdf8"});
    if (sc.debt>0) cats.push({label:"Debt Payments",val:sc.debt,color:"#f87171"});
  } else {
    cats.push({label:"All Spending",val:yd.spend,color:"#64748b"});
  }

  // ── SVG layout ──
  const W = 720, H = 400;
  const pad = {l:100, r:100, t:45, b:30};
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const col1 = pad.l;          // income sources (left edge of bars)
  const col2 = W/2 - 8;        // center column (tax + spend)
  const col3 = W - pad.r - 16; // leftover (right edge)
  const nw = 12; // node bar width

  // Scale to fit tallest column
  const total = annGross;
  const scale = total > 0 ? ch / total : 1;
  const minH = 4;

  // Cubic bezier flow path
  const flow = (x1, y1a, y1b, x2, y2a, y2b, curv) => {
    const c = curv || 0.55;
    const dx = (x2 - x1) * c;
    return `M${x1},${y1a} C${x1+dx},${y1a} ${x2-dx},${y2a} ${x2},${y2a} L${x2},${y2b} C${x2-dx},${y2b} ${x1+dx},${y1b} ${x1},${y1b} Z`;
  };

  // ── Stack left column: income sources ──
  const incSrc = [
    estYou > 0 && {label:"Your Pay",val:estYou,color:"#34d399"},
    estWife > 500 && {label:BASE.partnerName||"Partner",val:estWife,color:"#f472b6"},
    estGuard > 100 && {label:"Guard",val:estGuard,color:"#fbbf24"},
    estPension > 0 && {label:"Pension",val:estPension,color:"#a78bfa"},
    estSS > 0 && {label:"Soc. Sec.",val:estSS,color:"#38bdf8"},
  ].filter(Boolean);

  let iy = pad.t;
  const incStack = incSrc.map(s => {
    const h = Math.max(s.val * scale, minH);
    const n = {...s, y:iy, h};
    iy += h;
    return n;
  });

  // ── Stack center column: taxes (top, pulled left) + spending (bottom) ──
  // Tax
  const taxH = Math.max(annTax * scale, minH);
  const taxY = pad.t;
  // Spending categories
  let sy = taxY + taxH + 8;
  const spendStack = cats.map(c => {
    const h = Math.max(c.val * scale, minH);
    const n = {...c, y:sy, h};
    sy += h + 2;
    return n;
  });

  // ── Leftover ──
  const leftH = Math.max(Math.abs(annLeft) * scale, minH);
  const leftY = sy + 10;
  const leftCol = annLeft >= 0 ? "#34d399" : "#f87171";

  // ── Draw flows ──
  const paths = [];
  // Income → Center gross bar (left side flows to top of center)
  let incOff = pad.t;
  incStack.forEach(n => {
    paths.push({d:flow(col1+nw, n.y, n.y+n.h, col2, incOff, incOff+n.h), color:n.color, op:0.18});
    incOff += n.h;
  });

  // Center top → Tax (flows upward/right from gross into a red drain)
  paths.push({d:flow(col2+nw, taxY, taxY+taxH, col3, pad.t, pad.t+taxH*0.7), color:"#ef4444", op:0.15});

  // Center → Spending categories (flow right from take-home portion)
  let spOff = taxY + taxH + 8;
  spendStack.forEach(sp => {
    paths.push({d:flow(col2+nw, spOff, spOff+sp.h, col3, sp.y, sp.y+sp.h), color:sp.color, op:0.16});
    spOff += sp.h + 2;
  });

  // Center → Leftover
  if (leftH > 2) {
    paths.push({d:flow(col2+nw, spOff, spOff+leftH, col3, leftY, leftY+leftH), color:leftCol, op:0.2});
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
      <defs>
        {/* Subtle glow filter for the node bars */}
        <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Flow bands */}
      {paths.map((p,i) => <path key={i} d={p.d} fill={p.color} opacity={p.op}/>)}

      {/* Left column: income source bars + labels */}
      {incStack.map((n,i) => (
        <g key={i}>
          <rect x={col1} y={n.y} width={nw} height={n.h} rx={4} fill={n.color} filter="url(#glow)"/>
          <text x={col1-8} y={n.y+n.h/2+1} textAnchor="end" fill={n.color} fontSize={10} fontWeight={600} dominantBaseline="middle">{n.label}</text>
          <text x={col1-8} y={n.y+n.h/2+12} textAnchor="end" fill={C.textDim} fontSize={9} fontFamily="monospace">{fmt(n.val)}</text>
        </g>
      ))}

      {/* Center column: gross bar */}
      <rect x={col2} y={pad.t} width={nw} height={Math.max(total*scale, minH)} rx={4} fill="#22c55e" opacity={0.8} filter="url(#glow)"/>
      <text x={col2+nw/2} y={pad.t-8} textAnchor="middle" fill={C.green} fontSize={12} fontWeight={800} fontFamily="monospace">{fmt(annGross)}</text>
      <text x={col2+nw/2} y={pad.t-20} textAnchor="middle" fill={C.textDim} fontSize={9} fontWeight={600}>GROSS</text>

      {/* Right column: tax node */}
      <rect x={col3} y={pad.t} width={nw} height={taxH*0.7} rx={4} fill="#ef4444" opacity={0.85} filter="url(#glow)"/>
      <text x={col3+nw+8} y={pad.t+taxH*0.35+1} fill="#ef4444" fontSize={10} fontWeight={600} dominantBaseline="middle">Taxes</text>
      <text x={col3+nw+8} y={pad.t+taxH*0.35+13} fill={C.textDim} fontSize={9} fontFamily="monospace">{fmt(annTax)}</text>

      {/* Right column: spending category bars + labels */}
      {spendStack.map((sp,i) => (
        <g key={i}>
          <rect x={col3} y={sp.y} width={nw} height={sp.h} rx={3} fill={sp.color} opacity={0.85} filter="url(#glow)"/>
          <text x={col3+nw+8} y={sp.y+sp.h/2+1} fill={sp.color} fontSize={10} fontWeight={600} dominantBaseline="middle">{sp.label}</text>
          <text x={col3+nw+8} y={sp.y+sp.h/2+13} fill={C.textDim} fontSize={9} fontFamily="monospace">{fmt(sp.val)}</text>
        </g>
      ))}

      {/* Right column: leftover */}
      {leftH > 2 && (<g>
        <rect x={col3} y={leftY} width={nw} height={leftH} rx={4} fill={leftCol} opacity={0.9} filter="url(#glow)"/>
        <text x={col3+nw+8} y={leftY+leftH/2+1} fill={leftCol} fontSize={11} fontWeight={700} dominantBaseline="middle">
          {annLeft >= 0 ? "Surplus" : "Deficit"}
        </text>
        <text x={col3+nw+8} y={leftY+leftH/2+14} fill={leftCol} fontSize={10} fontFamily="monospace" fontWeight={700}>{fmt(annLeft)}</text>
      </g>)}

      {/* Column headers */}
      <text x={col1+nw/2} y={18} textAnchor="middle" fill={C.textDim} fontSize={9} fontWeight={700} letterSpacing={1.2}>INCOME</text>
      <text x={col3+nw/2} y={18} textAnchor="middle" fill={C.textDim} fontSize={9} fontWeight={700} letterSpacing={1.2}>OUTFLOWS</text>

      {/* Year tag */}
      <text x={W/2} y={H-6} textAnchor="middle" fill={C.textDim} fontSize={9}>{year} · Age {year-(BASE.birthYear||2003)}</text>
    </svg>
  );
};

export default SankeyChart;
