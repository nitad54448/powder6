// Direct public Moyo WASM API. No assigned space-group number is sent to the
// engine: it identifies the symmetry from the lattice and full-cell atoms.
import init, { analyze_cell, hall_symbol_entry } from '../lib/moyo/moyo_wasm.js';

self.onmessage=async function(event){
  const job=event.data || {};
  try{
    await init({module_or_path:new URL('../lib/moyo/moyo_wasm_bg.wasm',import.meta.url)});
    const cellJSON=JSON.stringify(job.cell);
    for(const tol of job.tolerances){
      try{
        const dataset=analyze_cell(cellJSON,tol,'Standard');
        self.postMessage({type:'result',tol,dataset,hall:hall_symbol_entry(dataset.hall_number).hall_symbol});
      }catch(error){self.postMessage({type:'result',tol,error:error.message || String(error)});}
    }
    self.postMessage({type:'complete'});
  }catch(error){self.postMessage({type:'error',error:error.message || String(error)});}
};
