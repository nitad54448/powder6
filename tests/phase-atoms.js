(async function(){
  'use strict';
  // Phases → Fragment… and Atoms from CIF…: the buttons, their dialogs, the atoms and restraints they make, and Undo.
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function check(ok,msg){if(!ok)throw Error(msg);}
  function record(name){results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);}
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV?.state?.S.tables || !w.RV.state.S.sgReady){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,doc=w.document,q=s=>doc.querySelector(s),errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    const dialog=async()=>{for(let i=0;i<100 && !q('#dlg').open;i++)await wait(20);check(q('#dlg').open,'No dialog opened');};
    const settle=async()=>{for(let i=0;i<100 && q('#dlg').open;i++)await wait(20);await frame();};
    const pick=(text,name)=>{RV.ui.pickFiles=async()=>[new w.File([text],name,{type:'text/plain'})];};
    RV.app.showTab('phases');await frame();
    check(q('#ph-tab-fragment').disabled && q('#ph-tab-cif-atoms').disabled,'Fragment / Atoms from CIF are enabled without a phase');
    record('Both buttons wait for a phase');

    const ph=St.makePhase({name:'cimetidine',sg:St.resolveSG(14),cell:{a:10.39,b:18.82,c:6.82,alpha:90,beta:106.5,gamma:90},atoms:[]});
    St.addPhase(ph);St.selectPhase(ph.key);await frame();
    check(!q('#ph-tab-fragment').disabled && q('[data-act="fragment"]:not(#ph-tab-fragment)'),'Fragment buttons missing or disabled with a phase');
    pick(await (await fetch('../test_files/cimetidine/cime.pdb')).text(),'cime.pdb');
    q('#ph-tab-fragment').click();await dialog();
    check(q('#f_skipH') && q('#f_skipH').checked && q('#f_restraints').checked,'Leave out H and Restraints are not offered, or not ticked');
    check(Number.isFinite(parseFloat(q('#f_x').value)) && !q('#f_mode'),'Centre missing, or Add/Replace offered for a phase without atoms');
    q('#dlg .btns .primary').click();await settle();
    check(ph.atoms.length===17 && ph.atoms.every(a=>a.site.mult===ph.ops.length),'The fragment did not give 17 atoms on general positions: '+ph.atoms.length);
    check(/^C1 N1 - /m.test(ph.restraints.text) && /fragment/i.test(q('#status-msg').textContent),'No restraints or no report: '+q('#status-msg').textContent);
    record('Fragment from cime.pdb: 17 heavy atoms on general positions, with bond and angle restraints');

    const cif=['data_x','_cell_length_a 10.39','_cell_length_b 18.82','_cell_length_c 6.82','_cell_angle_alpha 90','_cell_angle_beta 106.5','_cell_angle_gamma 90',"_space_group_name_H-M_alt 'P 1 21/c 1'",
      'loop_','_atom_site_label','_atom_site_type_symbol','_atom_site_fract_x','_atom_site_fract_y','_atom_site_fract_z','S1 S 0.11 0.21 0.31','N1 N 0.41 0.12 0.33'].join(String.fromCharCode(10));
    pick(cif,'two.cif');
    q('#ph-tab-cif-atoms').click();await dialog();
    check(q('#f_mode') && q('#f_mode').value==='replace','Atoms from CIF does not offer Replace first for a phase with atoms');
    q('#dlg .btns .primary').click();await settle();
    check(ph.atoms.map(a=>a.label).join()==='S1,N1' && !ph.restraints.text.trim(),'Replace kept old atoms or their rules: '+ph.atoms.map(a=>a.label).join()+' | '+ph.restraints.text.slice(0,40));
    record('Atoms from CIF replaces the atoms, and the rules of the old ones go');

    RV.cmd.undo();await frame();
    check(St.currentPhase().atoms.length===17 && /^C1 N1 - /m.test(St.currentPhase().restraints.text),'Undo lost the fragment or its restraints');
    record('Undo brings back the fragment with its restraints');
    check(!errors.length,errors.join('; '));
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:String(e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
