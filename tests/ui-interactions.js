(async function () {
    'use strict';
    const results=[],out=document.getElementById('results'),iframe=document.getElementById('app');
    function check(ok,message){if(!ok)throw new Error(message);}
    function near(a,b,message){check(Math.abs(a-b)<1e-7,message+': '+a+' vs '+b);}
    function record(name){results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);}
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    try {
        const w=iframe.contentWindow,deadline=Date.now()+20000;
        while(!w.RV || !w.RV.state || !w.RV.state.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw new Error('Application startup timed out');await wait(50);}
        const doc=w.document,RV=w.RV,St=RV.state,S=St.S,q=s=>doc.querySelector(s),frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
        const pageErrors=[];w.addEventListener('error',e=>pageErrors.push(e.message));
        St.setCalculation('rietveld');
        St.addPhase(St.makePhase({name:'sample',sg:St.resolveSG(1),cell:{a:4,b:4.1,c:4.2},profileType:'gsas_cw',atoms:[{label:'C1',type:'C',x:.13,y:.21,z:.32,occ:1,B:.5}]}));
        const raw={name:'pattern',tth:Array.from({length:1201},(_,i)=>10+i*.05),y:Array.from({length:1201},(_,i)=>100+5*Math.sin(i*.03)),inst:{bkgN:1,lambda2:0,ratio:0,resolutionType:'gsas_cw'}};
        let ds=St.insertDatasets([St.makeDataset(raw)],{estimate:false})[0];const id=ds.id;
        const other=St.makeDataset({...raw,name:'unselected'});S.datasets.push(other);RV.bus.emit('datasets');
        q('#tab-pattern').click();q('#tab-method').click();St.setSetting('showBkg',true);St.setSetting('showTicks',false);await frame();
        const plot=RV.plots._plots.pat;
        function view(){plot.auto=false;plot.view={x0:10,x1:70,y0:plot.ty(1),y1:plot.ty(300)};plot.draw();}
        function mouse(type,x,y,button,mods={}){const r=plot.canvas.getBoundingClientRect(),event=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:r.left+x,clientY:r.top+y,button,buttons:type==='mouseup'?0:button===2?2:1,...mods});const local=[event.clientX-r.left,event.clientY-r.top];plot.canvas.dispatchEvent(event);return local;}
        function clickData(x,y,mods={ctrlKey:true}){const px=plot.px(x),py=plot.py(plot.ty(y)),point=mouse('mousedown',px,py,0,mods),data=plot.dataAt(...point);mouse('mouseup',px,py,0,mods);return data;}
        const reset=q('[data-plot-action="auto"]');RV.plots.autoscale();await frame();
        check(reset.hidden,'Autoscale must hide in the automatic view');
        for(const p of [plot,RV.plots._plots.diff]){
            const b=p.box,r=p.canvas.getBoundingClientRect();
            const point=(type,fx,fy)=>p.canvas.dispatchEvent(new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='mouseup'?0:1,clientX:r.left+b.x0+fx*(b.x1-b.x0),clientY:r.top+b.y0+fy*(b.y1-b.y0)}));
            point('mousedown',.2,.2);point('mousemove',.8,.8);point('mouseup',.8,.8);
            check(!reset.hidden,'Autoscale must appear after zooming either plot');
            p.canvas.dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
            check(reset.hidden && plot.auto && RV.plots._plots.diff.auto,'Double-click must reset both linked plots and hide Autoscale');
        }
        mouse('mousedown',plot.box.x0+30,plot.box.y0+30,0);mouse('mousemove',plot.box.x1-30,plot.box.y1-30,0);mouse('mouseup',plot.box.x1-30,plot.box.y1-30,0);
        check(!reset.hidden,'Zooming must reveal Autoscale');reset.click();
        check(reset.hidden && plot.auto && RV.plots._plots.diff.auto,'Autoscale button must reset both plots and hide');
        record('Autoscale appears after zooming and hides after the button or either plot is reset');
        St.setSetting('showAnchors',false);await frame();check(!q('#show-anchors').checked,'Anchors preference did not clear its checkbox');
        view();const pointCount=ds.inst.bkgPoints.length,terms=ds.inst.bkgN;
        const chebPoint=clickData(23,81.25);await frame();
        check(ds.inst.bkgType==='cheb' && ds.inst.bkgN===terms,'Chebyshev point edit changed the polynomial order');
        check(ds.inst.bkgPoints.length===pointCount+1,'Ctrl-click did not add a Chebyshev target');
        check(!q('#show-anchors').closest('label').hidden,'Anchors must always be visible');
        check(Object.keys(ds.fit).filter(n=>/^bkg/.test(n)).every(n=>!ds.fit[n]),'Point fit did not hold background coefficients');
        let ci=ds.inst.bkgPoints.findIndex(p=>Math.abs(p.x-chebPoint[0])<1e-7);check(ci>=0,'Chebyshev target missing');
        q('#tab-datasets').click();await frame();let pointRow=q('[data-cheb-point="'+ci+'"]');check(pointRow,'Chebyshev target editor missing');
        const pointY=pointRow.querySelector('[data-cheb-coordinate="y"]');pointY.value='85';pointY.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
        near(ds.inst.bkgPoints[ci].y,85,'Chebyshev target height not committed');
        q('[data-cheb-fit]').click();await frame();check(!ds.fit.bkg0,'Fit to points must hold the coefficients');
        const use=q('[data-cheb-point="'+ci+'"] [data-cheb-use]');use.click();await frame();check(!ds.inst.bkgPoints[ci].use,'Point selection not saved');
        use.checked=true;RV.cmd.editChebPoint(ds,ci,'use',true);await frame();
        q('#tab-pattern').click();await frame();view();let startC=[plot.px(ds.inst.bkgPoints[ci].x),plot.py(plot.ty(85))],endC=[plot.px(25.25),plot.py(plot.ty(89))];
        mouse('mousedown',...startC,2);check(plot.drag.mode==='anchor','Chebyshev target cannot be dragged');mouse('mousemove',...endC,2);const releaseC=plot.dataAt(...mouse('mouseup',...endC,2));await frame();
        ci=ds.inst.bkgPoints.findIndex(p=>Math.abs(p.x-releaseC[0])<1e-7);check(ci>=0,'Chebyshev target release angle missing');near(ds.inst.bkgPoints[ci].y,releaseC[1],'Chebyshev target release height');
        record('Chebyshev targets support placement, editing, selection, fitting, and two-coordinate dragging without changing degree');
        St.setParam('bkg0',123.456,[ds]);const untouchedCoefficient=ds.p.bkg0;
        const chebDialog=RV.cmd.background();await frame();check(!q('#dlg [data-key="fitPoints"]'),'Background dialog must keep its original controls');
        q('#dlg .primary').click();await chebDialog;await frame();near(ds.p.bkg0,untouchedCoefficient,'Background dialog changed the point-fitted background');
        record('Background dialog retains the original controls and preserves coefficient values');
        const backgroundDialog=RV.cmd.background();await frame();
        check(q('#dlg [data-key="type"]').closest('.body').textContent.includes('all datasets'),'Background dialog does not explain its scope');
        q('#dlg [data-key="type"]').value='spline';q('#dlg [data-key="type"]').dispatchEvent(new w.Event('change',{bubbles:true}));
        q('#dlg [data-key="anchors"]').value='10 70';q('#dlg .primary').click();await backgroundDialog;await frame();
        check(other.inst.bkgType==='spline' && !q('#show-anchors').closest('label').hidden,'Explicit spline selection did not update all datasets or reveal Anchors');
        const placedPoints={};
        for(const [mode,x,y] of [['lin',23,81.25],['sqrt',37,93.75],['log',49,112.125]]){
            St.setSetting('yscale',mode);await frame();view();const point=clickData(x,y);placedPoints[mode]=point;await frame();
            check(S.settings.showAnchors && q('#show-anchors').checked,'Adding an anchor must enable and check Anchors');
            const index=ds.inst.bkgX.findIndex(a=>Math.abs(a-point[0])<1e-7);check(index>=0,'Anchor angle missing '+JSON.stringify({mode,anchors:ds.inst.bkgX,errors:pageErrors}));near(ds.p['bga'+index],point[1],mode+' cursor height');record('cursor placement on '+mode+' axis');
        }
        St.setSetting('yscale','lin');await frame();view();
        const middle=placedPoints.sqrt;
        let index=ds.inst.bkgX.findIndex(x=>Math.abs(x-middle[0])<1e-7),name='bga'+index;
        St.setFit(name,false,[ds]);await frame();
        let series=plot.series.find(s=>s.kind==='anchor' && s.ds.id===id && s.idxs.includes(index));
        check(series.hollow && series.color===RV.theme.get().anchorFixed,'Fixed anchor style');record('fixed anchors are gray and hollow');
        St.setFit(name,true,[ds]);await frame();
        series=plot.series.find(s=>s.kind==='anchor' && s.ds.id===id && s.idxs.includes(index));check(!series.hollow,'Refinable anchor must be filled');
        const originalTheme=S.settings.theme;
        for(const mode of ['light','dark']){
            St.setSetting('theme',mode);await frame();const theme=RV.theme.get();
            check(!theme.series.includes(theme.anchorRefinable),'Anchor color overlaps dataset palette in '+mode);
            for(const list of [[ds],[ds,other]]){
                const anchors=RV.plots.build(list).main.filter(s=>s.kind==='anchor' && !s.hollow && s.x.length);
                check(anchors.length && anchors.every(s=>s.color===theme.anchorRefinable),'Refinable anchors inherit dataset colors in '+mode);
            }
        }
        St.setSetting('theme',originalTheme);await frame();view();record('refinable anchors have a separate color in both themes with one or multiple datasets');
        RV.bus.emit('paramFocus',{name});await frame();
        check(plot.series.some(s=>s.mode==='vline' && s.x.some(x=>Math.abs(x-middle[0])<1e-7) && s.color===RV.theme.get().anchorActive),'Yellow editing line missing');
        const px=plot.px(middle[0]),sampleY=plot.box.y0+.39*(plot.box.y1-plot.box.y0),pixels=plot.ctx.getImageData(Math.round((px-2)*plot.dpr),Math.round(sampleY*plot.dpr),Math.ceil(5*plot.dpr),1).data;
        let yellow=false;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>150 && pixels[i+1]>110 && pixels[i+2]<110)yellow=true;
        check(yellow,'Yellow marker was not painted on canvas '+JSON.stringify({pixels:Array.from(pixels),px,sampleY,dpr:plot.dpr,width:plot.canvas.width,height:plot.canvas.height,view:plot.view,box:plot.box,color:RV.theme.get().anchorActive,hidden:Array.from(plot.hidden)}));record('editing a parameter paints a yellow vertical marker');
        RV.bus.emit('paramFocus',null);await frame();check(!plot.series.some(s=>s.mode==='vline'),'Editing marker remains after blur');
        St.setFit(name,false,[ds]);await frame();view();
        let start=[plot.px(middle[0]),plot.py(plot.ty(middle[1]))],end=[plot.px(42),plot.py(plot.ty(106.5))];
        mouse('mousedown',...start,2);check(plot.drag.mode==='anchor','Right mouse did not select anchor drag');
        const dragged=plot.dataAt(...mouse('mousemove',...end,2));await frame();
        near(ds.inst.bkgX[index],middle[0],'Preview changed persistent angle');check(plot.series.some(s=>s.mode==='vline' && s.x.some(x=>Math.abs(x-dragged[0])<1e-7)),'Drag marker does not follow cursor');
        end=[plot.px(43),plot.py(plot.ty(108))];const released=plot.dataAt(...mouse('mouseup',...end,2));await frame();index=ds.inst.bkgX.findIndex(x=>Math.abs(x-released[0])<1e-7);check(index>=0,'Release angle not saved');near(ds.p['bga'+index],released[1],'Release height not saved');check(!ds.fit['bga'+index],'Drag changed fixed flag');record('right-drag previews and saves both release coordinates with the fixed flag');
        RV.history.undo();await frame();ds=St.byId(id);index=ds.inst.bkgX.findIndex(x=>Math.abs(x-middle[0])<1e-7);check(index>=0,'One undo did not restore anchor');near(ds.p['bga'+index],middle[1],'Undo height');record('one undo restores the complete anchor move');
        view();start=[plot.px(middle[0]),plot.py(plot.ty(middle[1]))];end=[plot.px(41),plot.py(plot.ty(102))];mouse('mousedown',...start,2);mouse('mousemove',...end,2);w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await frame();check(!plot.drag,'Escape did not cancel drag');near(ds.inst.bkgX[index],middle[0],'Canceled angle');record('Escape cancels an anchor preview');
        view();start=[plot.px(33),plot.py(plot.ty(220))];end=[plot.px(35),plot.py(plot.ty(220))];const regionStart=plot.dataAt(...mouse('mousedown',...start,0,{ctrlKey:true,shiftKey:true}));check(plot.drag.mode==='region','Exclusion gesture intercepted');const regionEnd=plot.dataAt(...mouse('mousemove',...end,0,{ctrlKey:true,shiftKey:true}));mouse('mouseup',...end,0,{ctrlKey:true,shiftKey:true});await frame();check(ds.inst.excl.some(r=>Math.abs(r[0]-regionStart[0])<1e-7 && Math.abs(r[1]-regionEnd[0])<1e-7),'Exclusion not saved');record('Ctrl+Shift+drag still edits exclusions');
        view();start=[plot.px(54),plot.py(plot.ty(220))];end=[plot.px(56),plot.py(plot.ty(220))];mouse('mousedown',...start,2);check(plot.drag.mode==='pan','Right drag away from anchors does not pan');mouse('mousemove',...end,2);mouse('mouseup',...end,2);record('right-drag elsewhere still pans');
        RV.layout.showResult(S.calculation);Object.keys(ds.fit).forEach(n=>ds.fit[n]=false);RV.bus.emit('params',{});
        q('#tab-datasets').click();await frame();const untouched=JSON.stringify(other.fit);
        q('[data-fit-group="profile"]').click();check(ds.fit['p1.size'] && ds.fit['p1.sizeMix'],'Sample group did not select sample parameters');check(!ds.fit['inst.U'],'Sample group changed resolution');
        q('[data-fit-group="resolution"]').click();check(ds.fit['inst.U'] && ds.fit['inst.SL'],'Resolution group did not select calibration parameters');
        check(q('.prow[data-name="inst.U"] .pf').checked,'Right-panel Resolution checkbox did not update');check(JSON.stringify(St.byId(other.id).fit)===untouched,'Group toggle changed an unselected dataset');record('Sample and Resolution controls update independent right-panel groups');
        const b='p1.C1.B';St.setParam(b,1.75,[ds]);St.setCalculation('lebail');ds.p[b]=8.5;
        q('#tab-phases').click();RV.phasesTab.values();let atomic=q('#ph-atoms [data-at="B"]');near(Number(atomic.value),S.phases[0].v[b],'Phase definition shows a dataset B');check(!atomic.readOnly,'Phase starting model cannot be edited');check(q('#phase-src').textContent.includes('Shared phase definition'),'Phase definition label missing');
        const saveResult=()=>{ds.stats={ok:true,msg:'converged',n:ds.tth.length,nVar:0,Rp:0,Rwp:0,Rexp:0,chi2red:0,phases:[]};RV.fitHistory.complete(RV.fitHistory.begin([ds],false),[ds]);};saveResult();RV.layout.showResult(S.calculation);RV.results.render();check(!q('.calc-layout[data-layout="lebail"] [data-res-part="atoms"]'),'Le Bail still displays an Atoms section');check(w.CifStructure.parse(RV.results.cifText([ds],true)).atoms.find(a=>a.siteLabel==='C1').biso===1.75,'Le Bail pdCIF lost the retained Rietveld atoms');
        St.setCalculation('wppf');RV.phasesTab.values();near(Number(q('#ph-atoms [data-at="B"]').value),S.phases[0].v[b],'WPPF changes phase starting B');
        saveResult();RV.layout.showResult('wppf');RV.results.render();check(!q('.calc-layout[data-layout="wppf"] [data-res-part="atoms"]'),'WPPF still displays an Atoms section');check(w.CifStructure.parse(RV.results.cifText([ds],true)).atoms.find(a=>a.siteLabel==='C1').biso===1.75,'WPPF pdCIF lost the retained Rietveld atoms');record('Le Bail and WPPF omit atom tables and preserve the retained atoms in pdCIF');
        // Phases: the Structure block draws the starting model; the starting model and a dataset exchange values on request
        St.setCalculation('rietveld');q('#tab-phases').click();await frame();
        const sacc=q('details[data-acc="phase-structure"]');check(sacc,'Phases has no Structure block');sacc.open=true;await frame();await frame();
        check(q('#ph-struct').childElementCount>0 && q('#ph-struct-src').options.length>=2,'The phase structure was not drawn, or offers no dataset model');
        const startB=S.phases[0].v[b];ds.p[b]=1.33;
        q('[data-act="model-from-dataset"]').click();await frame();q('#dlg [data-key="source"]').value=String(ds.id);q('#dlg .btns .primary').click();await frame();
        near(S.phases[0].v[b],1.33,'Dataset → starting model did not take the dataset B');
        ds.p[b]=1.75;S.phases[0].v[b]=0.66;
        q('[data-act="model-to-datasets"]').click();await frame();q('#dlg .btns .primary').click();await frame();
        near(ds.p[b],0.66,'Starting model → datasets did not copy B');
        S.phases[0].v[b]=startB;St.setParam(b,1.75,[ds]);   // restored by hand: Undo would replace the dataset objects this page holds
        record('Phases: a Structure block, Starting model → datasets and Dataset → starting model');
        St.setCalculation('rietveld');RV.phasesTab.values();atomic=q('#ph-atoms [data-at="B"]');near(Number(atomic.value),S.phases[0].v[b],'Dataset B changed the phase definition');q('#tab-datasets').click();await frame();atomic=q('.prow[data-name="'+b+'"] .pv');check(!atomic.readOnly,'Dataset atomic B is read only');near(Number(atomic.value),1.75,'Rietveld dataset B changed');record('dataset atomic values and phase starting models have separate ownership');
        const atomAcc=atomic.closest('details[data-acc^="dataset-atoms-"]');
        check(atomAcc && atomAcc.querySelectorAll('.pgroup').length===S.phases[0].atoms.length,'Dataset atoms are not grouped by phase');
        const datasetStructure=atomAcc.nextElementSibling;
        check(datasetStructure && datasetStructure.dataset.acc==='dataset-structure-'+S.phases[0].key,'Dataset Structure is not directly after its atoms');
        atomAcc.open=false;datasetStructure.open=true;await frame();await frame();
        check(atomAcc.getBoundingClientRect().height<=atomAcc.querySelector('summary').getBoundingClientRect().height+3 && datasetStructure.querySelector('canvas'),'Collapsing dataset atoms hid Structure or prevented its viewer');
        atomAcc.open=true;await frame();
        record('Dataset atoms collapse together and their Structure viewer remains available below them');
        // no panel headings, no help line: the mouse controls are behind a round "i" at the right of the first toolbar row
        q('#tab-pattern').click();await frame();
        check(!q('.panel-heading') && !q('.phint'),'A panel heading or the plot help line is still there');
        const info=q('#ptools .info-btn'),pop=q('#plot-help'),firstRow=q('#ptools [data-yscale="lin"]'),tools=q('#ptools').getBoundingClientRect(),ib=info.getBoundingClientRect(),fr=firstRow.getBoundingClientRect();
        check(info.textContent==='i' && info.getAttribute('aria-describedby')==='plot-help' && pop.getAttribute('role')==='tooltip','The info icon is not an accessible "i" with a tooltip');
        check(Math.abs((ib.top+ib.height/2)-(fr.top+fr.height/2))<8,'The "i" is not on the line of the intensity scale: '+ib.top+' vs '+fr.top);
        check(tools.right-ib.right<24 && tools.right-ib.right>=0,'The "i" is not at the right of the toolbar: '+(tools.right-ib.right));
        check(w.getComputedStyle(pop).display==='none','The tooltip is shown without hover');
        info.focus();await frame();
        check(w.getComputedStyle(pop).display!=='none' && /Drag/.test(pop.textContent) && /Shift-drag/.test(pop.textContent) && /Right-drag an anchor/.test(pop.textContent) && /Ctrl\+Shift\+drag/.test(pop.textContent) && /Double-click/.test(pop.textContent),'The tooltip is empty or lacks a gesture: '+pop.textContent);
        const pr=pop.getBoundingClientRect(),pl=q('.results-panel').getBoundingClientRect();
        check(pr.right<=pl.right+1 && pr.left>=pl.left && pr.bottom<=pl.bottom,'The tooltip is clipped by its panel');
        info.blur();await frame();check(w.getComputedStyle(pop).display==='none','The tooltip stays open after focus leaves');
        record('the plot help is a round "i" at the right of the toolbar, with the gestures in its tooltip; panel headings are gone');
        St.selectIds([ds.id]);RV.workspace.inspectDataset(ds.id);
        Object.assign(ds.p,{'inst.U':3.96361,'inst.V':-43.01288,'inst.W':18.71003});
        const diagnosticJob=St.problemFor([ds]);diagnosticJob.vars=['zero','inst.X','p1.size'].map(name=>({d:0,name}));
        const diagnosticResult=w.RVCore.refine(diagnosticJob,{evaluateOnly:true});check(diagnosticResult.ok,diagnosticResult.msg);check(!diagnosticResult.covarianceOK,'Profile fixture did not produce singular covariance');
        St.applyResult([ds],diagnosticResult,diagnosticJob,false);RV.fitHistory.complete(RV.fitHistory.begin([ds],false),[ds]);RV.layout.showResult('rietveld');q('#tab-datasets').click();RV.bus.emit('stats');RV.results.render();await frame();
        const diagnostics=q('.calc-layout[data-layout="rietveld"] [data-res-part="summary"]').textContent;
        check(diagnostics.includes('Fit diagnostics') && diagnostics.includes('Gaussian variance') && diagnostics.includes('inst.X, p1.size'),'Results hide the profile and covariance diagnostics');
        const zeroUncertainty=q('.prow[data-name="zero"] .ps');check(zeroUncertainty.textContent==='no s.u.' && zeroUncertainty.title.includes('does not establish'),'Zero shift is misleadingly marked unconstrained');
        check(q('#param-stats').textContent.includes('Gaussian variance'),'Dataset statistics hide the profile diagnostic');record('profile and covariance diagnostics explain missing uncertainties in Datasets and Results');
        check(!pageErrors.length,'Browser errors: '+pageErrors.join('\n'));
        window.browserTestResult={ok:true,results};
    } catch(e) {results.push({name:'failure',error:e.stack || String(e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
