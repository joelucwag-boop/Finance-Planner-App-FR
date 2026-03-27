import { useState } from 'react';
import { C, fmtInput } from '../constants.js';

const InputRow = ({field, value, onChange}) => {
  const {key, label, min, max, step, fmt: f, help} = field;
  const [editing, setEditing] = useState(false);
  const [textVal, setTextVal] = useState("");

  const startEdit = () => { setEditing(true); setTextVal(String(
    f==="%"||f==="%2" ? (value*100) : value
  )); };
  const commitEdit = () => {
    let v = parseFloat(textVal);
    if (isNaN(v)) { setEditing(false); return; }
    if (f==="%"||f==="%2") v = v / 100;
    onChange(Math.max(min, Math.min(max, v)));
    setEditing(false);
  };

  // Text fields (names, etc) — render as plain text input, no slider
  if (f === "text") return (
    <div style={{padding:"5px 0",borderBottom:`1px solid ${C.border}15`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11,color:C.textMid,fontWeight:400}}>{label}</span>
        <input value={value||""} onChange={e => onChange(e.target.value)}
          style={{width:120,background:C.bg,color:C.text,border:`1px solid ${C.border}`,
            borderRadius:4,padding:"3px 8px",fontSize:12,fontFamily:"'Outfit',sans-serif",
            fontWeight:600,textAlign:"right",outline:"none"}} />
      </div>
      {help && <div style={{fontSize:9,color:C.textDim,marginTop:1}}>{help}</div>}
    </div>
  );

  return (
    <div style={{padding:"5px 0",borderBottom:`1px solid ${C.border}15`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
        <span style={{fontSize:11,color:C.textMid,fontWeight:400}}>
          {label}
        </span>
        {editing ? (
          <input value={textVal} onChange={e=>setTextVal(e.target.value)}
            onBlur={commitEdit} onKeyDown={e=>e.key==="Enter"&&commitEdit()}
            autoFocus
            style={{width:80,background:C.bg,color:C.blue,border:`1px solid ${C.blue}`,
              borderRadius:4,padding:"2px 6px",fontSize:12,fontFamily:"monospace",
              fontWeight:700,textAlign:"right",outline:"none"}} />
        ) : (
          <span onClick={startEdit} style={{fontSize:12,fontWeight:700,fontFamily:"monospace",
            color:C.text,cursor:"text",padding:"1px 4px",borderRadius:3,
            background:"transparent"}}>
            {fmtInput(value, f)}
          </span>
        )}
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{width:"100%",height:4,WebkitAppearance:"none",appearance:"none",
          background:`linear-gradient(90deg, ${C.blue} ${((value-min)/(max-min))*100}%, ${C.border} ${((value-min)/(max-min))*100}%)`,
          borderRadius:2,outline:"none",cursor:"pointer"}} />
      {help && <div style={{fontSize:9,color:C.textDim,marginTop:1}}>{help}</div>}
    </div>
  );
};

export default InputRow;
