import { C } from '../constants.js';
import InputRow from './InputRow.jsx';

const InputSection = ({section, inputs, onChange, isOpen, toggle}) => {
  return (
    <div style={{marginBottom:2}}>
      <button onClick={toggle} style={{
        width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",
        padding:"8px 10px",background:isOpen?`${C.blue}0a`:"transparent",
        border:`1px solid ${isOpen?C.blue+"33":C.border}`,borderRadius:8,
        cursor:"pointer",color:C.text,fontSize:12,fontWeight:600,
      }}>
        <span>{section.label}</span>
        <span style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:10,color:C.textDim}}>{isOpen?"▼":"▶"}</span>
        </span>
      </button>
      {isOpen && (
        <div style={{padding:"6px 8px"}}>
          {section.fields.map(f => (
            <InputRow key={f.key} field={f} value={inputs[f.key]}
              onChange={v => onChange(f.key, v)} />
          ))}
        </div>
      )}
    </div>
  );
};

export default InputSection;
