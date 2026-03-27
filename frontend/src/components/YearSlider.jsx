import { C, BASE, EVENTS, moName } from '../constants.js';

const YearSlider = ({year,onChange,min=BASE.startYear||2026,max=(BASE.startYear||2026)+43}) => {
  const pct = ((year-min)/(max-min))*100;
  const nearEvent = EVENTS.find(e => e.yr === year);
  return (
    <div style={{padding:"0 4px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <span style={{fontSize:12,color:C.textDim}}>
          {year} · Age {year-(BASE.birthYear||2003)}
          {nearEvent && <span style={{marginLeft:8,color:C.amber}}>{nearEvent.emoji} {nearEvent.label}</span>}
        </span>
        <span style={{fontSize:11,color:C.textDim}}>Year {year-2025} of career</span>
      </div>
      <div style={{position:"relative",height:30}}>
        <div style={{position:"absolute",top:12,left:0,right:0,height:6,
          background:C.border,borderRadius:3}} />
        <div style={{position:"absolute",top:12,left:0,width:`${pct}%`,height:6,
          background:`linear-gradient(90deg,${C.blue},${C.purple})`,borderRadius:3,
          transition:"width 0.15s ease"}} />
        {EVENTS.map((e,i) => {
          const ep = ((e.yr-min)/(max-min))*100;
          return (
            <div key={i} style={{position:"absolute",top:8,left:`${ep}%`,width:14,height:14,
              transform:"translateX(-7px)",fontSize:10,lineHeight:"14px",textAlign:"center",
              cursor:"pointer",zIndex:2}}
              onClick={() => onChange(e.yr)} title={`${e.yr}: ${e.label}`}>{e.emoji}</div>
          );
        })}
        <input type="range" min={min} max={max} value={year}
          onChange={e => onChange(Number(e.target.value))}
          style={{position:"absolute",top:2,left:0,width:"100%",height:24,
            opacity:0,cursor:"pointer",zIndex:3}} />
      </div>
    </div>
  );
};

export default YearSlider;
