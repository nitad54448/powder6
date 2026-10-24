/* Dataset setup and batch selection. Observations remain in the shared state;
 * this workspace reuses the existing instrument, background and fit commands. */
RV.datasets = (function () {
  'use strict';
  var St=RV.state,S=St.S,ui=RV.ui,esc=ui.esc,dirty=true,lastRender=0,queued=0;
  function $(q){return document.querySelector(q);}
  function active(){return RV.app && RV.app.commandTab()==='datasets';}
  function render(force){
    dirty=true;if(!active())return;
    if(S.busy && !force && performance.now()-lastRender<1000)return;
    lastRender=performance.now();dirty=false;
    $('#dataset-summary').textContent=S.sel.size+' selected / '+S.datasets.length+' datasets for fitting and plotting.';
  }
  function schedule(){dirty=true;if(!active() || queued)return;queued=requestAnimationFrame(function(){queued=0;render(false);});}
  function init(){
    function simulationButtons(){document.querySelectorAll('[data-dataset-action="simulate"],[data-act="simulate"]').forEach(function(b){ui.able(b,S.busy?'Calculation running.':S.phases.some(St.canRietveld)?'':'Add atoms to a phase before simulation.');});}
    RV.bus.on('phases',simulationButtons);RV.bus.on('busy',simulationButtons);simulationButtons();
    var pane=$('#pane-datasets');
    pane.addEventListener('click',function(e){var b=e.target.closest('[data-dataset-action]');if(!b || S.busy)return;switch(b.dataset.datasetAction){
      case 'read':RV.cmd.readData();break;case 'demo':RV.cmd.demo();break;case 'simulate':RV.cmd.simulate();break;case 'delete':RV.cmd.deleteDatasets();break;case 'all':St.selectAll();break;case 'none':St.selectIds([]);break;case 'parameters':RV.app.showSide('params');break;
      case 'individual':St.store('fitmode','single');RV.bus.emit('fitmode');RV.cmd.fitSelected();break;
    }});
    pane.addEventListener('change',function(e){if(S.busy)return;var el=e.target,id,d;
      if((id=el.getAttribute('data-dataset-select'))){St.toggle(+id);return;}
      if((id=el.getAttribute('data-dataset-name'))){d=St.byId(+id);if(!d)return;var name=el.value.trim();if(!name){el.value=d.name;return;}RV.history.take('rename dataset '+d.name);St.rename(d.id,name);}
    });
    ['datasets','selection','stats','data','phases','phaseSel','calculation'].forEach(function(ev){RV.bus.on(ev,schedule);});
    RV.bus.on('busy',function(b){if(!b)schedule();});
    RV.bus.on('tab',function(t){if(t==='datasets' && dirty)render(true);});
  }
  return {init:init,render:render};
})();
