import { C, EVENTS } from '../constants.js';

const Timeline = ({currentYear}) => (
  <div style={{display:"flex",gap:0,overflowX:"auto",padding:"6px 0",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`}}>
    {EVENTS.map((e,i) => {
      const past=e.yr<=currentYear, active=e.yr===currentYear;
      return (
        <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",
          minWidth:66,padding:"3px 5px",opacity:past?1:0.4,transition:"opacity 0.2s"}}>
          <div style={{fontSize:18,marginBottom:3,filter:active?`drop-shadow(0 0 6px ${C.amber})`:"none"}}>{e.emoji}</div>
          <div style={{fontSize:9,color:active?C.amber:C.text,fontWeight:active?700:500,textAlign:"center",lineHeight:1.3}}>{e.label}</div>
          <div style={{fontSize:8,color:C.textDim}}>{e.yr}</div>
        </div>
      );
    })}
  </div>
);

export default Timeline;
