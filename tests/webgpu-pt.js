/* Serve the repository, then open tests/webgpu-pt.html in a WebGPU browser.
 * Tests execute real shaders and compare their costs with the CPU model.
 */
(async function () {
    'use strict';
    const results = [], output = document.getElementById('results');
    function check(on, message) { if (!on) throw new Error(message); }
    function record(name, extra) { results.push({name,...extra}); output.textContent=JSON.stringify(results,null,2); }
    const identity={r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]}, inversion={r:[-1,0,0,0,-1,0,0,0,-1],t:[0,0,0]};
    const ff={xray:{a:[2.31,1.02,1.5886,.865],b:[20.8439,10.2075,.5687,51.6512],c:.2156},neutron:6.646};
    function problem(method,profileType,options={}) {
        const ops=[identity,inversion], cell={a:3.7,b:4.1,c:4.3,alpha:87,beta:94,gamma:102}, key='p1', C=RVCore;
        const ph={key,method,system:'triclinic',profileType,ops,poDir:[0,0,1],separatedProfile:!!options.separated,
            broadening:options.broadening||{size:'isotropic',strain:'isotropic'},atoms:[{label:'C1',ff,site:C.siteSymmetry(ops,[.13,.21,.32],cell)}]};
        const values={zero:.03,disp:1.5,transp:.00001,bkg0:13,bkg1:2,'p1.scale':.012,'p1.po':.87};
        Object.entries(cell).forEach(([n,v])=>values['p1.'+n]=v);
        const defs=C.usesSeparatedProfile(ph)?C.SAMPLE_PROFILE:C.PROFILE_PARAMS[profileType];
        defs.forEach(([n,v])=>values['p1.'+n]=v);
        C.instrumentProfileParams(profileType).forEach(([n,v])=>values['inst.'+n]=v);
        Object.assign(values,{'p1.C1.x':.13,'p1.C1.y':.21,'p1.C1.z':.32,'p1.C1.occ':1,'p1.C1.B':.5});
        if(C.usesSeparatedProfile(ph)) Object.assign(values,{'p1.size':.2,'p1.sizeAxial':.4,'p1.sizeB':.3,'p1.sizeC':.45,'p1.rotA':13,'p1.rotB':21,'p1.rotC':33,'p1.strain':150,'p1.strainAxial':230,'p1.S400':4,'p1.S040':5,'p1.S004':6,'p1.sizeMix':.6,'p1.strainMix':.4});
        const ds={id:1,tth:Float64Array.from({length:160},(_,i)=>8+i*.35),y:new Float64Array(160),w:new Float64Array(160).fill(.01),lambda1:1.540598,lambda2:1.544,ratio:.5,polK:.83,radiation:options.neutron?'neutron':'xray',bkgType:options.spline?'spline':'cheb',bkgN:2,bkgX:options.spline?[8,20,40,63.65]:[],minFwhm:.07,phases:['p1']};
        if(options.spline)Object.assign(values,{bga0:12,bga1:15,bga2:11,bga3:18});
        const names=['p1.a','p1.b','p1.c','zero','disp','transp',options.spline?'bga1':'bkg0'];
        if(method==='rietveld')names.push('p1.scale','p1.po','p1.C1.x','p1.C1.y','p1.C1.z','p1.C1.B','p1.C1.occ');
        const widthNames=C.profileParamsFor(ph,ds,values);
        for(const n of ['GU','LX','eta','GU_L','GU_R','LX_L','LX_R','eta_split','U','W','X','Y','SL','HL','size','sizeMix','strainMix','strain','sizeAxial','sizeB','rotB','S400'])if(Number.isFinite(widthNames[n]))names.push((C.usesSeparatedProfile(ph)&&C.instrumentProfileParams(profileType).some(p=>p[0]===n)?'inst.':'p1.')+n);
        const limits={};names.forEach(n=>{if(/^p1\.[abc]$/.test(n))limits[n]=[values[n]*.96,values[n]*1.04];});
        const job={phases:[ph],datasets:[ds],values:[values],vars:names.map(name=>({name,d:0})),limits,algorithm:'pt',pt:{chains:4,sweeps:10,maxTemp:5,seed:137},maxIter:1};
        // Give extraction tests data with overlapping, positive and bound intensities.
        const model=new C.Model(job);model.lbAsWppf=true;
        const parts=model.evalDataset(0,values);
        for(let i=0;i<ds.y.length;i++){let y=parts.y[i];if(method!=='rietveld')y+=300*Math.exp(-Math.pow((ds.tth[i]-31.7)/.35,2))+140*Math.exp(-Math.pow((ds.tth[i]-45.4)/.5,2));ds.y[i]=y+2*Math.sin(i*.13)+1;}
        ds.w[5]=0;
        return job;
    }
    async function context(job) {
        let captured;
        const result=await RVCore.refineAsync(job,{linearStart:false,ptBackend:ctx=>{captured=ctx;return {x:ctx.x,pt:{backend:'test',sweeps:0}};}});
        check(result.ok,result.msg);check(captured,'No PT context');return captured;
    }
    try {
        check(!!navigator.gpu,'WebGPU is unavailable');
        const adapter=await navigator.gpu.requestAdapter();check(adapter,'No WebGPU adapter');
        const device=await adapter.requestDevice();
        record('adapter',{info:adapter.info && {vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device}});
        for(const method of ['rietveld','wppf','lebail'])for(const profileType of ['simple_pvoigt','split_pvoigt','tch_aniso','gsas_cw']){
            const ctx=await context(problem(method,profileType)),gpu=await RVPTGPU.create(ctx,{device});
            try{
                const probes=[Array.from(ctx.x),...[-.12,.12,.3].map(s=>Array.from(ctx.x,(v,j)=>Math.max(ctx.info[j].lo,Math.min(ctx.info[j].hi,v+s*ctx.setup.scales[j]))))];
                const costs=await gpu.costs(probes);let worst=0;
                for(let j=0;j<probes.length;j++){const cpu=ctx.cost(probes[j]),relative=Math.abs(costs[j]-cpu)/Math.max(1,cpu);worst=Math.max(worst,relative);check(relative<.001,method+' '+profileType+' cost '+costs[j]+' vs CPU '+cpu+' relative '+relative);}
                record(method+' '+profileType,{pass:true,relativeError:worst});
            }finally{gpu.close();}
        }
        for(const options of [{spline:true,neutron:true},{separated:true,broadening:{size:'uniaxial',strain:'uniaxial',sizeAxis:[1,0,1],strainAxis:[1,1,0]}},{separated:true,broadening:{size:'ellipsoid',strain:'stephens'}}]){
            const ctx=await context(problem('rietveld','simple_pvoigt',options)),gpu=await RVPTGPU.create(ctx,{device});
            try{const costs=await gpu.costs([ctx.x]);const cpu=ctx.cost(ctx.x),relative=Math.abs(costs[0]-cpu)/Math.max(1,cpu);check(relative<.001,'Broadening/spline cost mismatch '+relative);record('extra '+JSON.stringify(options),{pass:true,relativeError:relative});}finally{gpu.close();}
        }
        // Negative trial variances must use the same stable continuation on
        // the CPU and GPU, including well beyond float32 cancellation.
        for(const U of [3.96361,-1e5]){
            const job=problem('rietveld','gsas_cw');
            Object.assign(job.values[0],{'inst.U':U,'inst.V':-43.01288,'inst.W':18.71003,'inst.X':1.40615,'inst.Y':4.800405,'inst.Z':.01277393});
            const ctx=await context(job),gpu=await RVPTGPU.create(ctx,{device});
            try{const costs=await gpu.costs([ctx.x]),cpu=ctx.cost(ctx.x),relative=Math.abs(costs[0]-cpu)/Math.max(1,cpu);check(relative<.001,'Negative variance continuation mismatch '+relative);record('negative Gaussian variance U='+U,{pass:true,relativeError:relative});}finally{gpu.close();}
        }
        // f' and f'' of the dataset reach the GPU structure factors as they do the CPU ones.
        {
            const job=problem('rietveld','tch_aniso');job.phases[0].atoms[0].element='C';job.datasets[0].anomalous={C:[-0.5,1.2]};
            const ctx=await context(job),gpu=await RVPTGPU.create(ctx,{device});
            try{const costs=await gpu.costs([ctx.x]),cpu=ctx.cost(ctx.x),relative=Math.abs(costs[0]-cpu)/Math.max(1,cpu);check(relative<.001,'Anomalous dispersion mismatch '+relative);record('anomalous dispersion',{pass:true,relativeError:relative});}finally{gpu.close();}
        }
        // Dataset sharing, dependent coordinates, occupancy sums, held values,
        // mixed phases and a phase absent from one dataset share one GPU job.
        const joint=problem('rietveld','gsas_cw'),ph=joint.phases[0],v=joint.values[0];
        ph.atoms.push({label:'C2',ff,site:RVCore.siteSymmetry(ph.ops,[.26,.33,.41],{a:3.7,b:4.1,c:4.3,alpha:87,beta:94,gamma:102})});
        Object.assign(v,{'p1.C1.occ':.4,'p1.C2.x':.065,'p1.C2.y':.33,'p1.C2.z':.41,'p1.C2.occ':.6,'p1.C2.B':.5});
        ph.constraints=[{kind:'hold',component:'B',atoms:['C1']},{kind:'equiv',component:'x',atoms:['C1','C2'],mult:[1,.5]},{kind:'sum',component:'occ',atoms:['C1','C2'],mult:[1,1],total:1}];
        const wp=structuredClone(ph);wp.key='p2';wp.method='wppf';wp.constraints=[];joint.phases.push(wp);
        Object.keys(v).filter(n=>n.startsWith('p1.')).forEach(n=>v['p2.'+n.slice(3)]=v[n]);
        joint.datasets[0].phases.push('p2');
        const second=structuredClone(joint.datasets[0]);second.id=2;second.phases=['p1'];second.radiation='neutron';second.lambda2=0;second.ratio=0;
        joint.datasets.push(second);joint.values.push({...v,bkg0:18,zero:-.02});
        joint.vars.push({name:'p1.C2.x',d:0},{name:'p1.C2.occ',d:0});
        joint.vars=joint.vars.flatMap(v=>/^(bkg0|zero)$/.test(v.name)?[{name:v.name,d:0},{name:v.name,d:1}]:[{name:v.name,d:-1,ds:[0,1]}]);
        const jm=new RVCore.Model(joint);jm.lbAsWppf=true;
        joint.datasets.forEach((d,i)=>{const ev=jm.evalDataset(i,joint.values[i]);d.y=Float64Array.from(ev.y,(y,j)=>y+2*Math.sin(j*.13)+1);});
        const jc=await context(joint),jg=await RVPTGPU.create(jc,{device});
        try{const probes=[Array.from(jc.x),Array.from(jc.x,(v,j)=>Math.max(jc.info[j].lo,Math.min(jc.info[j].hi,v+.1*jc.setup.scales[j])))];const costs=await jg.costs(probes);let worst=0;
            for(let i=0;i<costs.length;i++){const cpu=jc.cost(probes[i%probes.length]),relative=Math.abs(costs[i]-cpu)/Math.max(1,cpu);check(relative<.001,'Global/constraint cost mismatch '+relative);worst=Math.max(worst,relative);}record('global sharing, atomic constraints and mixed phases',{pass:true,relativeError:worst});
        }finally{jg.close();}
        const scoped=problem('rietveld','gsas_cw'),sd=structuredClone(scoped.datasets[0]);sd.id=2;sd.resolutionType='split_pvoigt';scoped.datasets[0].resolutionType='simple_pvoigt';scoped.datasets.push(sd);scoped.values.push({...scoped.values[0]});
        scoped.values.forEach(v=>RVCore.ALL_INSTRUMENT_PROFILE.forEach(([n,value])=>v['inst.'+n]=value));
        scoped.vars=scoped.vars.filter(v=>['bkg0','zero','p1.C1.B'].includes(v.name));scoped.vars.push({name:'bkg0',d:1},{name:'zero',d:1},{name:'p1.C1.B',d:1});
        scoped.parameterLinks=[{source:{datasetId:1,name:'p1.C1.B'},target:{datasetId:2,name:'p1.C1.B'},factor:1.2,offset:.1}];scoped.values[1]['p1.C1.B']=.7;
        const sm=new RVCore.Model(scoped);scoped.datasets.forEach((d,i)=>d.y=Float64Array.from(sm.evalDataset(i,scoped.values[i]).y,(y,j)=>y+1+Math.sin(j*.13)));
        const sc=await context(scoped),sgpu=await RVPTGPU.create(sc,{device});try{const probes=[Array.from(sc.x),Array.from(sc.x,(v,j)=>Math.max(sc.info[j].lo,Math.min(sc.info[j].hi,v+.1*sc.setup.scales[j])))],costs=await sgpu.costs(probes);let worst=0;for(let i=0;i<probes.length;i++){const cpu=sc.cost(probes[i]),relative=Math.abs(costs[i]-cpu)/Math.max(1,cpu);check(relative<.001,'Dataset profile / cross-dataset link mismatch '+relative);worst=Math.max(worst,relative);}record('dataset-specific resolution functions and exact cross-dataset links',{pass:true,relativeError:worst});}finally{sgpu.close();}
        // A negative-allowed box must still preserve physical Gaussian variance
        // in every live GPU replica, including after exchanges.
        const guarded=problem('rietveld','gsas_cw');guarded.vars=[{name:'inst.W',d:0}];guarded.limits={'inst.W':[-100,100]};
        Object.assign(guarded.values[0],{'inst.U':0,'inst.V':0,'inst.W':1});
        const guardCtx=await context(guarded);guardCtx.setup.scales[0]=10;const guardGPU=await RVPTGPU.create(guardCtx,{device});
        try{guardGPU.initial([guardCtx.x]);await guardGPU.batch(1,true);const state=await guardGPU.batch(10,false);
            for(let c=0;c<guardCtx.setup.chains;c++){check(state[c*guardGPU.plan.stride]>=0,'GPU accepted negative Gaussian variance');check(guardCtx.feasible([state[c*guardGPU.plan.stride+2]]),'GPU retained an infeasible best');}
            record('GPU replica and best-candidate physical variance guard',{pass:true});
        }finally{guardGPU.close();}
        // A centered high-symmetry phase exercises coset weights and fixed sites.
        const sg=(await (await fetch('../sg/all.json')).json()).space_groups['225'],setting=sg.settings[0],centered=problem('rietveld','gsas_cw');
        const cp=centered.phases[0];cp.ops=RVCore.expandOps(setting.sym_ops,setting.centring_translations);cp.system='cubic';
        cp.atoms[0].site=RVCore.siteSymmetry(cp.ops,[0,0,0],{a:5.6,b:5.6,c:5.6,alpha:90,beta:90,gamma:90});
        Object.assign(centered.values[0],{'p1.a':5.6,'p1.C1.x':0,'p1.C1.y':0,'p1.C1.z':0});
        centered.vars=centered.vars.filter(v=>!/^p1\.(b|c|C1\.[xyz])$/.test(v.name));centered.limits['p1.a']=[5,6];
        const cm=new RVCore.Model(centered);centered.datasets[0].y=Float64Array.from(cm.evalDataset(0,centered.values[0]).y,(y,j)=>y+2*Math.sin(j*.13)+1);
        centered.datasets[0].w=Float64Array.from(centered.datasets[0].y,y=>1/Math.max(1,y));
        const cc=await context(centered),cg=await RVPTGPU.create(cc,{device});
        try{const values=await cg.costs([cc.x]),cpu=cc.cost(cc.x),relative=Math.abs(values[0]-cpu)/Math.max(1,cpu);check(relative<.001,'Centered/fixed-site mismatch '+relative);record('Fm-3m centering and fixed Wyckoff site',{pass:true,relativeError:relative});}finally{cg.close();}
        const large=problem('rietveld','gsas_cw'),ld=large.datasets[0];
        ld.tth=Float64Array.from({length:12000},(_,i)=>8+i*64/11999);ld.y=new Float64Array(12000);ld.w=new Float64Array(12000).fill(.01);
        const lm=new RVCore.Model(large);ld.y=Float64Array.from(lm.evalDataset(0,large.values[0]).y,(y,j)=>y+2*Math.sin(j*.13)+1);
        const lc=await context(large),lg=await RVPTGPU.create(lc,{device});
        try{check(lg.plan.chains*lg.plan.columnCount>4194240,'Fixture does not exercise 2D dispatch');const values=await lg.costs([lc.x]),cpu=lc.cost(lc.x),relative=Math.abs(values[0]-cpu)/Math.max(1,cpu);check(relative<.001,'2D dispatch cost mismatch '+relative);record('large buffers and 2D GPU dispatch',{pass:true,relativeError:relative});}finally{lg.close();}
        device.destroy();
        const job=problem('rietveld','gsas_cw'),progress=[];
        const result=await RVCore.refineAsync(job,{linearStart:false,onIter:p=>progress.push(p)});
        check(result.ok,result.msg);check(result.pt.backend==='webgpu','Unexpected fallback: '+result.pt.fallbackReason);
        check(result.pt.proposals===job.pt.chains*job.pt.sweeps*job.vars.length,'Wrong proposal count (a sweep is one proposal per variable per replica)');check(result.pt.swapAttempts>0,'No replica exchanges');
        check(result.pt.bestChi2<=result.pt.initialChi2,'PT lost its initial best');check(progress.some(p=>p.backend==='webgpu'),'No GPU progress');
        record('complete GPU PT + CPU LM',{pass:true,pt:result.pt,chi2:result.chi2});
        for(const method of ['rietveld','wppf','lebail']){
            const worker=new Worker('../js/rietveld_worker.js'),job=problem(method,'gsas_cw');
            try{const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fit worker timed out')),120000);worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.onmessage=e=>{if(e.data.type==='done'){clearTimeout(timer);resolve(e.data.result);}};worker.postMessage({type:'refine',id:1,problem:job});});
                check(result.ok,result.msg);check(result.pt.backend==='webgpu',method+' worker fallback: '+result.pt.fallbackReason);check(result.pt.proposals===job.pt.chains*job.pt.sweeps*job.vars.length,'Wrong worker proposal count');record(method+' actual fit worker',{pass:true,chi2:result.chi2});
            }finally{worker.terminate();}
        }
        const rejected=await RVCore.refineAsync(problem('rietveld','gsas_cw'),{linearStart:false,ptBackend:async ctx=>{
            const original=ctx.cost;ctx.cost=x=>original(x)+1000;
            try{return await RVPTGPU.run(ctx);}finally{ctx.cost=original;}
        }});
        check(rejected.ok,rejected.msg);check(rejected.pt.backend==='cpu','Inaccurate GPU was not rejected');check(/disagrees/.test(rejected.pt.fallbackReason),'Wrong validation fallback reason');
        record('failed GPU cost validation restarts CPU PT',{pass:true});
        const lossAdapter=await navigator.gpu.requestAdapter(),lossDevice=await lossAdapter.requestDevice();
        const lossContext=await context(problem('rietveld','gsas_cw')),lossSession=await RVPTGPU.create(lossContext,{device:lossDevice});
        try{lossDevice.destroy();let failed=false;try{await lossSession.costs([lossContext.x]);}catch{failed=true;}check(failed,'Lost GPU device was not detected');record('GPU device loss is detected',{pass:true});}finally{lossSession.close();}
        window.gpuTestResult={ok:true,results};
    }catch(e){record('failure',{error:e.stack||String(e)});window.gpuTestResult={ok:false,results};}
})();
