// Direct public Moyo WASM API. No assigned space-group number is sent to the
// engine: it identifies the symmetry from the lattice and full-cell atoms.
// The engine is compiled once and the worker kept for the next search;
// every message carries the id of the search it answers.
import init, { analyze_cell, hall_symbol_entry } from '../lib/moyo/moyo_wasm.js';

let ready=null;
self.onmessage=async function(event){
  const job=event.data || {},id=job.id;
  try{
    ready=ready || init({module_or_path:new URL('../lib/moyo/moyo_wasm_bg.wasm',import.meta.url)});
    await ready;
    const cellJSON=JSON.stringify(job.cell);
    for(const tol of job.tolerances){
      try{
        const dataset=analyze_cell(cellJSON,tol,'Standard');
        self.postMessage({id,type:'result',tol,dataset,hall:hall_symbol_entry(dataset.hall_number).hall_symbol});
      }catch(error){self.postMessage({id,type:'result',tol,error:error.message || String(error)});}
    }
    self.postMessage({id,type:'complete'});
  }catch(error){ready=null;self.postMessage({id,type:'error',error:error.message || String(error)});}
};
