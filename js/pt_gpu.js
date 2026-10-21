/* WebGPU parallel tempering for RVCore. The numerical search stays on the GPU:
 * proposals, cells, structure factors, all peak profiles, backgrounds, joint
 * nonnegative intensity solves, chi2, Metropolis decisions and replica exchange.
 * CPU work is setup, validation, progress and double-precision candidate checks.
 * Any unavailable/failed/inaccurate GPU path restarts the original CPU PT.
 * No GPU approximation is used for final LM, covariance or reported intensities.
 */
(function (root) {
    'use strict';
    const f = n => {
        if (!Number.isFinite(n) || Math.abs(n) > 3e38) throw new Error('PT value exceeds WebGPU floating-point range.');
        const s = String(n); return /[.e]/i.test(s) ? s : s + '.0';
    };
    const u = n => n + 'u';
    const vec = a => 'vec3<f32>(' + a.map(f).join(',') + ')';
    const mono = ex => ex.split('').flatMap((n, i) => Array(Number(n)).fill('h.' + 'xyz'[i])).join('*') || '1.0';
    const product = (a, b) => '(' + a + ')*(' + b + ')';
    const sum = a => a.length ? '(' + a.join('+') + ')' : '0.0';

    function compile(ctx) {
        const C = root.RVCore, problem = ctx.problem, nv = ctx.x.length, chains = ctx.setup.chains;
        const data = [], functions = [], pairs = [], datasets = [], parameters = [], ids = new Map();
        const put = a => { const start = data.length; for(const v of a)data.push(v); return start; };
        const slots = problem.datasets.map(() => new Map());
        ctx.info.forEach((info, j) => info.ds.forEach(d => slots[d].set(problem.vars[j].name, j)));
        function param(d, name, fallback = 0) {
            const key = d + ':' + name;
            if (!ids.has(key)) {
                ids.set(key, parameters.length);
                const value = problem.values[d][name];
                parameters.push({ d, name, value:Number.isFinite(value) ? value : fallback, slot:slots[d].has(name) ? slots[d].get(name) : -1 });
            }
            return 'p(c,' + u(ids.get(key)) + ')';
        }
        function metricCode(P, d) {
            const pre = P.prefix, get = (n, fallback) => param(d, pre + n, fallback);
            let a = get('a', 5), b = get('b', 5), c = get('c', 5), al = '90.0', be = al, ga = al;
            switch (P.def.system) {
                case 'cubic': b = c = a; break;
                case 'tetragonal': b = a; break;
                case 'hexagonal': case 'trigonal': case 'rhombohedral': b = a; ga = '120.0'; break;
                case 'monoclinic': {
                    const key = {a:'alpha',c:'gamma'}[P.def.uniqueAxis] || 'beta';
                    if (key === 'alpha') al = get(key,90); else if (key === 'beta') be = get(key,90); else ga = get(key,90);
                    break;
                }
                case 'orthorhombic': break;
                default: al = get('alpha',90); be = get('beta',90); ga = get('gamma',90);
            }
            return 'metric(' + [a,b,c,al,be,ga].join(',') + ')';
        }
        function widths(P, D, d, name, side) {
            const sep = C.usesSeparatedProfile(P.def), type = P.def.profileType;
            const instrument = new Map(C.instrumentProfileParams(type));
            const get = (n, def = 0) => sep && instrument.has(n) ? param(d,'inst.'+n,instrument.get(n)) : P.profNames.includes(n) ? param(d,P.prefix+n,def) : f(def);
            const suffix = side || '', split = type === 'split_pvoigt';
            let code = '', sigma, gamma;
            if (sep) {
                const broad = C.broadeningConfig(P.def.broadening);
                code += `let nh = normalize(g.cart*h); var invSize = 1.0/max(0.001,${get('size',1)}); var strain = max(0.0,${get('strain')});\n`;
                if (broad.size === 'uniaxial') code += `let sc = angle2(g,nh,${vec(broad.sizeAxis)}); invSize=sqrt((1.0-sc)/sq(max(0.001,${get('size',1)}))+sc/sq(max(0.001,${get('sizeAxial',1)})));\n`;
                if (broad.size === 'ellipsoid') code += `var nhp=nh; nhp=rotate(nhp,2u,-${get('rotC')}*RAD); nhp=rotate(nhp,1u,-${get('rotB')}*RAD); nhp=rotate(nhp,0u,-${get('rotA')}*RAD); invSize=length(nhp/vec3<f32>(max(0.001,${get('size',1)}),max(0.001,${get('sizeB',1)}),max(0.001,${get('sizeC',1)})));\n`;
                if (broad.strain === 'uniaxial') code += `let ec=angle2(g,nh,${vec(broad.strainAxis)}); let ei=max(0.0,${get('strain')}); let ea=max(0.0,${get('strainAxial')}); strain=ei*ea/max(1e-30,sqrt(ei*ei*ec+ea*ea*(1.0-ec)));\n`;
                if (broad.strain === 'stephens') {
                    const basis = gsasStephensBasis(P.def.ops);
                    const terms = (basis || gsasStrainKeys(P.def.system,P.def.uniqueAxis).map(n => {
                        const key = n.slice(1), weight = key.includes('4') ? 1 : key.includes('3') ? 2 : key.includes('0') ? 3 : 4;
                        return {name:n,coeff:GSAS_QUARTIC.map(k => k === key ? weight : 0)};
                    })).map(t => product(get(t.name), sum(t.coeff.flatMap((v,i) => v ? [product(f(v),mono(GSAS_QUARTIC[i]))] : []))));
                    code += `strain=spacing*spacing*sqrt(max(0.0,${sum(terms)}));\n`;
                }
                code += `let sg=1.8*${f(D.def.lambda1)}*invSize/(PI*ct); let eg=0.018*strain*tt/PI; let sm=clamp(${get('sizeMix',1)},0.0,1.0); let em=clamp(${get('strainMix',1)},0.0,1.0);\n`;
                sigma = `${get('U'+suffix)}*tt*tt+${get('V'+suffix)}*tt+${get('W'+suffix)}+(sq(sg*(1.0-sm))+sq(eg*(1.0-em)))/(8.0*log(2.0))`;
                gamma = `${get('X'+suffix)}/ct+${split ? '0.0' : get('Y')+'*tt+'+get('Z')}+sg*sm+eg*em`;
            } else {
                const simple = type === 'simple_pvoigt';
                sigma = `${get((simple || split ? 'GU' : 'U')+suffix)}*tt*tt+${get((simple || split ? 'GV' : 'V')+suffix)}*tt+${get((simple || split ? 'GW' : 'W')+suffix)}` + (simple ? `+${get('GP')}/max(1e-9,cs*cs)` : '');
                gamma = `${get((simple || split ? 'LX' : 'X')+suffix)}/ct` + (!simple && !split ? '+'+get('Y')+'*tt' : '');
            }
            code += `var hg=gaussian(${sigma},${f(D.def.minFwhm)}); var hl=lorentzian(${gamma},${f(D.def.minFwhm)});\n`;
            if (!sep && type === 'tch_aniso') {
                const hex = /hexagonal|trigonal|rhombohedral/.test(P.def.system);
                const quartic = hex ? `${get('S400')}*sq(h.x*h.x+h.x*h.y+h.y*h.y)+${get('S004')}*sq(h.z*h.z)+${get('S202')}*(h.x*h.x+h.x*h.y+h.y*h.y)*h.z*h.z` :
                    ['400','040','004','220','202','022'].map(n => product(get('S'+n),mono(n))).join('+');
                code += `let ag=${f(STEPHENS_PREFACTOR)}*spacing*spacing*sqrt(max(0.0,${quartic}))/1000.0*tt; let ae=clamp(${get('eta_aniso',STEPHENS_DEFAULT_ETA)},0.0,1.0); hl+=ag*ae; hg=sqrt(hg*hg+sq(ag*(1.0-ae)));\n`;
            }
            functions.push(`fn ${name}(c:u32,tc:f32,h:vec3<f32>,spacing:f32,g:Metric)->vec2<f32>{
                let theta=min(tc*RAD*0.5,PI*0.5-1e-6); if(theta<1e-6){return vec2<f32>(${f(D.def.minFwhm)});}
                let tt=tan(theta); let cs=cos(theta); let ct=max(1e-9,cs); ${code}
                return vec2<f32>(softFloor(hg,${f(D.def.minFwhm)}),softFloor(hl,${f(D.def.minFwhm)}));
            }`);
            return get;
        }
        let pointCount = 0, reflectionCount = 0, columnCount = 0, workCount = 0;
        const validCells = [];
        ctx.model.datasets.forEach((D,d) => {
            const obs = [];
            for (let i=0;i<D.n;i++) obs.push(D.def.tth[i],D.def.y[i],D.def.w[i]);
            const ds = { d, n:D.n, pointStart:pointCount, obs:put(obs), pairs:[], free:[], target:workCount };
            pointCount += D.n; workCount += D.n;
            functions.push(background(D,d,ds,param));
            ctx.model.phases.forEach((P,pi) => {
                if (!D.has[pi]) return;
                const cell = C.cellOf(P.def.system,P.def.uniqueAxis,n => problem.values[d][P.prefix+n]);
                const lmax = Math.max(D.def.lambda1,D.def.ratio>0 ? D.def.lambda2 || 0 : 0);
                const dmin = lmax/(2*Math.sin(Math.min(179,D.def.tth[D.n-1]+3)*Math.PI/360))*0.98;
                const upper = n => {
                    const slot=slots[d].get(P.prefix+n); return slot == null ? cell[n] : ctx.info[slot].hi;
                };
                let maxes = ['a','b','c'].map(upper);
                if (P.def.system === 'cubic') maxes = Array(3).fill(maxes[0]);
                else if (/tetragonal|hexagonal|trigonal|rhombohedral/.test(P.def.system)) maxes[1] = maxes[0];
                if (!maxes.every(n => n>0 && Number.isFinite(n))) throw new Error('PT cell limits need finite positive upper bounds for WebGPU.');
                const box=maxes.map(n => Math.floor(n/dmin));
                if (box.reduce((a,n)=>a*(2*n+1),1)>1000000) throw new Error('PT reflection envelope exceeds the WebGPU setup budget.');
                const cellMoves=P.cellNames.some(n=>slots[d].has(P.prefix+n));
                const anglesMove=P.cellNames.some(n=>!/^[abc]$/.test(n) && slots[d].has(P.prefix+n));
                const orthogonal=['alpha','beta','gamma'].every(n=>cell[n]===90);
                const monotone=!anglesMove && (orthogonal || /hexagonal|trigonal|rhombohedral/.test(P.def.system));
                // Only oblique variable metrics need the complete Miller-index
                // box; prune indices impossible throughout monotone cell bounds.
                const envelope=Object.assign({},cell,{a:maxes[0],b:maxes[1],c:maxes[2]});
                const list=!cellMoves ? C.generateReflections(cell,P.def.ops,dmin) : monotone ? C.generateReflections(envelope,P.def.ops,dmin) : C.generateReflections(cell,P.def.ops,dmin,box);
                const pair={index:pairs.length,d,n:D.n,start:reflectionCount,count:list.length,column:columnCount,method:P.method,ds,ratio:D.def.ratio>1e-6 && D.def.lambda2>1e-6 && Math.abs(D.def.lambda1-D.def.lambda2)>1e-6 ? D.def.ratio : 0};
                reflectionCount+=list.length; columnCount+=list.length*D.n;
                ds.pairs.push(pair); pairs.push(pair);
                const refs=[];
                list.forEach((r,j) => {
                    const eq=put(Array.from(r.eq)); refs.push(r.h,r.k,r.l,r.m,eq,r.eq.length/3);
                    if(P.method!=='rietveld') ds.free.push({ref:pair.start+j,col:pair.column+j*D.n});
                });
                pair.refs=put(refs);
                const op=put(P.reps.flatMap(o=>o.r.concat(o.t)));
                const g=metricCode(P,d); validCells.push(g+'.valid>0.5');
                const get=widths(P,D,d,'width_'+pair.index,'');
                if(P.def.profileType==='split_pvoigt') {
                    widths(P,D,d,'left_'+pair.index,'_L'); widths(P,D,d,'right_'+pair.index,'_R');
                }
                const pre=P.prefix, par=n=>param(d,pre+n), type=P.def.profileType==='simple_pvoigt'?1:P.def.profileType==='split_pvoigt'?2:3;
                let struct='var height=0.0;';
                if(P.method==='rietveld') {
                    struct+='var fr=0.0; var fi=0.0;';
                    (P.def.atoms||[]).forEach((at,j) => {
                        const pos=at.site.r0.map((v,i)=>sum([f(v),...at.site.free.map(fc=>product(param(d,pre+at.label+'.'+'xyz'[fc]),f(at.site.basis[fc][i])))]));
                        const ff=D.def.radiation==='neutron' ? f(at.ff.neutron) : sum([f(at.ff.xray.c),...at.ff.xray.a.map((a,k)=>`${f(a)}*exp(-(${f(at.ff.xray.b[k])})*q*0.25)`)]);
                        struct+=`{let pos=vec3<f32>(${pos.join(',')}); let weight=${param(d,pre+at.label+'.occ')}*(${ff})*exp(-${param(d,pre+at.label+'.B')}*q*0.25)*${f(at.site.mult/P.reps.length)}; var ar=0.0; var ai=0.0;
                            for(var j=0u;j<${u(P.reps.length)};j++){let o=${u(op)}+12u*j; let hh=vec3<f32>(dot(h,vec3<f32>(dat[o],dat[o+3u],dat[o+6u])),dot(h,vec3<f32>(dat[o+1u],dat[o+4u],dat[o+7u])),dot(h,vec3<f32>(dat[o+2u],dat[o+5u],dat[o+8u]))); let ph=2.0*PI*fract(dot(hh,pos)+dot(h,vec3<f32>(dat[o+9u],dat[o+10u],dat[o+11u]))); ar+=cos(ph); ai+=sin(ph);}
                            fr+=weight*ar; fi+=weight*ai;}`;
                    });
                    struct+=`var po=1.0; let pr=${par('po')}; let direction=${vec(P.def.poDir||[0,0,1])}; let hh=dot(direction,g.g*direction);
                        if(pr>0.0 && abs(pr-1.0)>1e-12 && hh>0.0){po=0.0; for(var j=0u;j<u32(dat[rr+5u]);j++){let o=u32(dat[rr+4u])+3u*j; let e=vec3<f32>(dat[o],dat[o+1u],dat[o+2u]); let c2=min(1.0,sq(dot(e,g.g*direction))/max(1e-30,dot(e,g.g*e)*hh)); po+=pow(pr*pr*c2+(1.0-c2)/pr,-1.5);} po/=dat[rr+5u];}
                        height=${par('scale')}*dat[rr+3u]*lp(tc,${f(D.def.polK)})*po*(fr*fr+fi*fi)/pk.area;`;
                }
                const mk = (angle,centre) => `makePeak(${angle},${centre},width_${pair.index}(c,${angle},h,spacing,g),${type===2?`left_${pair.index}(c,${angle},h,spacing,g)`:'vec2<f32>(0.0)'},${type===2?`right_${pair.index}(c,${angle},h,spacing,g)`:'vec2<f32>(0.0)'},${u(type)},${get(type===2?'eta_split':'eta',0.5)},${type===3?`(${get('SL')}/tan(${angle}*RAD*0.5)+${get('HL')})`:'0.0'})`;
                functions.push(`fn phase_${pair.index}(c:u32,ri:u32){
                    let rr=${u(pair.refs)}+6u*(ri-${u(pair.start)}); let h=vec3<f32>(dat[rr],dat[rr+1u],dat[rr+2u]); let g=${g}; let q=dot(h,g.g*h); let idx=(c*NR+ri)*2u;
                    peaks[idx]=Peak(); peaks[idx+1u]=Peak();
                    if(q<=0.0 || q>${f(1/(dmin*dmin)*(1+1e-9))} || g.valid<0.5){return;}
                    let sint=${f(D.def.lambda1*0.5)}*sqrt(q); if(sint>=1.0){return;} let spacing=inverseSqrt(q);
                    let bragg=2.0*asin(sint)/RAD; let tth=bragg+shift(bragg,${param(d,'disp')},${param(d,'transp')}); let tc=tth+${param(d,'zero')};
                    var pk=${mk('tc','tc')}; ${struct} pk.height=height; peaks[idx]=pk;
                    ${D.def.ratio>1e-6 && D.def.lambda2>1e-6 && Math.abs(D.def.lambda1-D.def.lambda2)>1e-6 ? `let st2=sin(tth*RAD*0.5)*${f(D.def.lambda2/D.def.lambda1)}; if(abs(st2)<1.0){let tc2=2.0*asin(st2)/RAD+${param(d,'zero')}; var pk2=${mk('tc2','tc2')}; pk2.height=height; peaks[idx+1u]=pk2;}` : ''}
                }`);
            });
            ds.m=ds.free.length;
            if(ds.m>2048) throw new Error('PT has more than 2048 potential free reflection intensities in one dataset; using the CPU solver.');
            ds.freeData=put(ds.free.flatMap(r=>[r.ref,r.col]));
            ds.H=workCount; workCount+=ds.m*ds.m;
            ds.rhs=workCount; workCount+=ds.m;
            ds.scale=workCount; workCount+=ds.m;
            ds.x=workCount; workCount+=ds.m;
            ds.grad=workCount; workCount+=ds.m;
            ds.factor=workCount; workCount+=ds.m*ds.m;
            ds.solution=workCount; workCount+=ds.m;
            ds.passive=workCount; workCount+=ds.m;
            ds.converged=workCount++;
            datasets.push(ds);
        });
        if (!reflectionCount) throw new Error('No reflections for WebGPU PT.');
        if (ctx.constraints) ctx.constraints.names.forEach(name => problem.datasets.forEach((ds,d) => {
            if (Number.isFinite(problem.values[d][name])) param(d,name);
        }));
        let linked='';
        if(ctx.constraints) ctx.constraints.links.forEach(link => {
            const expression=sum([f(link.offset),...link.terms.map(t=>product(f(t[1]),`state[c*STRIDE+NV+${u(t[0])}]`))]);
            param(link.d,link.name); linked+=`case ${u(ids.get(link.d+':'+link.name))}:{return ${expression};}\n`;
        });
        const values=put(parameters.map(p=>p.value)), mapping=put(parameters.map(p=>p.slot));
        const bounds=put(ctx.info.flatMap((p,j)=>[Number.isFinite(p.lo)?p.lo:-3e38,Number.isFinite(p.hi)?p.hi:3e38,ctx.setup.scales[j]]));
        const checks=validCells.slice();
        if(ctx.constraints) ctx.constraints.names.forEach(name=>problem.datasets.forEach((ds,d)=>{
            if(!Number.isFinite(problem.values[d][name]))return;
            const lim=AtomicConstraints.limits({limits:problem.limits},name,problem.values[d][name]), p=param(d,name);
            if(Number.isFinite(lim[0]))checks.push(p+'>='+f(lim[0])+'-1e-6*(1.0+abs('+p+'))');
            if(Number.isFinite(lim[1]))checks.push(p+'<='+f(lim[1])+'+1e-6*(1.0+abs('+p+'))');
        }));
        const header=`const NV:u32=${u(nv)}; const NR:u32=${u(reflectionCount)}; const NP:u32=${u(pointCount)}; const NC:u32=${u(columnCount)}; const NW:u32=${u(workCount)}; const CHAINS:u32=${u(chains)}; const STRIDE:u32=${u(3*nv+12)};
            const BOUNDS:u32=${u(bounds)}; const SEED:u32=${u(ctx.setup.seed)}; const MAX_TEMP:f32=${f(ctx.setup.maxTemp)};
            fn p(c:u32,k:u32)->f32{switch(k){${linked} default:{let slot=i32(dat[${u(mapping)}+k]); if(slot>=0){return state[c*STRIDE+NV+u32(slot)];} return dat[${u(values)}+k];}}}
            fn valid(c:u32)->bool{return ${checks.length?checks.map(v=>'('+v+')').join(' && '):'true'};}`;
        const shader=SHADER.replace('/*GENERATED*/',header+'\n'+functions.join('\n')+'\n'+kernels(datasets,pairs)).replaceAll('id.x','linearId(id)')+'\nfn linearId(id:vec3<u32>)->u32{return id.x+id.y*4194240u;}';
        return { shader, data:new Float32Array(data), nv, chains, stride:3*nv+12, pointCount, reflectionCount,columnCount,workCount,datasets };
    }

    function background(D,d,ds,param) {
        const get=n=>param(d,n);
        if(!D.spline) return `fn background_${d}(c:u32,t:f32)->f32{let z=2.0*(t-${f(D.def.tth[0])})/${f(D.def.tth[D.n-1]-D.def.tth[0])}-1.0; var a=1.0; var b=z; var result=0.0; ${D.T.map((_,j)=>j===0?`result+=${get('bkg0')};`:j===1?`result+=${get('bkg1')}*b;`:`{let next=2.0*z*b-a; a=b; b=next; result+=${get('bkg'+j)}*b;}`).join('')} return result;}`;
        const xs=D.bkgX,n=xs.length;
        if(n<2)return `fn background_${d}(c:u32,t:f32)->f32{return ${n?get('bga0'):'0.0'};}`;
        return `fn background_${d}(c:u32,t:f32)->f32{
            let xs=array<f32,${n}>(${xs.map(f).join(',')}); var ys:array<f32,${n}>; var h:array<f32,${n-1}>; var dd:array<f32,${n-1}>; var m:array<f32,${n}>;
            ${xs.map((_,j)=>`ys[${j}]=${get('bga'+j)};`).join('')}
            for(var j=0u;j<${u(n-1)};j++){h[j]=xs[j+1u]-xs[j]; dd[j]=(ys[j+1u]-ys[j])/h[j];}
            m[0]=dd[0];m[${n-1}]=dd[${n-2}];
            for(var j=1u;j<${u(n-1)};j++){m[j]=select((h[j]*dd[j-1u]+h[j-1u]*dd[j])/(h[j-1u]+h[j]),0.0,dd[j-1u]*dd[j]<=0.0);}
            for(var j=0u;j<${u(n-1)};j++){if(dd[j]==0.0){m[j]=0.0;m[j+1u]=0.0;}else{let a=m[j]/dd[j];let b=m[j+1u]/dd[j];let tau=a*a+b*b;if(tau>9.0){let z=3.0/sqrt(tau);m[j]=z*a*dd[j];m[j+1u]=z*b*dd[j];}}}
            if(t<=xs[0]){return ys[0];}if(t>=xs[${n-1}]){return ys[${n-1}];}var j=0u;while(j<${u(n-2)} && xs[j+1u]<=t){j++;}
            let z=(t-xs[j])/h[j];let z2=z*z;let z3=z2*z;return (2.0*z3-3.0*z2+1.0)*ys[j]+(z3-2.0*z2+z)*h[j]*m[j]+(-2.0*z3+3.0*z2)*ys[j+1u]+(z3-z2)*h[j]*m[j+1u];
        }`;
    }

    function kernels(datasets,pairs) {
        return `
        @compute @workgroup_size(64) fn geometry(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x/NR;let r=id.x%NR;if(c>=CHAINS){return;} ${pairs.map(p=>`if(r>=${u(p.start)} && r<${u(p.start+p.count)}){phase_${p.index}(c,r);return;}`).join('')}}
        @compute @workgroup_size(64) fn columns(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x/NC;let k=id.x%NC;if(c>=CHAINS){return;} ${pairs.map(p=>`if(k>=${u(p.column)} && k<${u(p.column+p.count*p.n)}){let i=(k-${u(p.column)})%${u(p.n)};let r=${u(p.start)}+(k-${u(p.column)})/${u(p.n)};let t=dat[${u(p.ds.obs)}+3u*i];let pk=(c*NR+r)*2u;col[c*NC+k]=profile(t,peaks[pk])+${f(p.ratio)}*profile(t,peaks[pk+1u]);return;}`).join('')}}
        @compute @workgroup_size(64) fn targets(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x/NP;let ip=id.x%NP;if(c>=CHAINS){return;}let wb=c*NW;
            ${datasets.map(d=>`if(ip>=${u(d.pointStart)} && ip<${u(d.pointStart+d.n)}){let i=ip-${u(d.pointStart)};let t=dat[${u(d.obs)}+3u*i];var fixed=background_${d.d}(c,t);${d.pairs.filter(p=>p.method==='rietveld').map(p=>`for(var r=0u;r<${u(p.count)};r++){fixed+=col[c*NC+${u(p.column)}+r*${u(d.n)}+i]*peaks[(c*NR+${u(p.start)}+r)*2u].height;}`).join('')}work[wb+${u(d.target)}+i]=dat[${u(d.obs)}+3u*i+1u]-fixed;return;}`).join('')}
        }
        ${datasets.filter(d=>d.m).map(d=>nnlsKernels(d)).join('\n')}
        fn pointEnergy(c:u32,ip:u32)->f32{let wb=c*NW;${datasets.map(d=>`if(ip>=${u(d.pointStart)} && ip<${u(d.pointStart+d.n)}){let i=ip-${u(d.pointStart)};let w=dat[${u(d.obs)}+3u*i+2u];if(w<=0.0){return 0.0;}var residual=work[wb+${u(d.target)}+i];${d.m?`for(var j=0u;j<${u(d.m)};j++){let off=u32(dat[${u(d.freeData)}+2u*j+1u]);let scale=work[wb+${u(d.scale)}+j];if(scale>0.0){residual-=col[c*NC+off+i]*work[wb+${u(d.x)}+j]/scale;}}`:''}return w*residual*residual;}`).join('')}return 0.0;}
        fn solved(c:u32)->bool{return ${datasets.filter(d=>d.m).map(d=>`work[c*NW+${u(d.converged)}]>0.5`).join(' && ')||'true'};}
        `;
    }

    function nnlsKernels(d) {
        const m=u(d.m), n=u(d.n), H=u(d.H), rhs=u(d.rhs), scale=u(d.scale), x=u(d.x), grad=u(d.grad), conv=u(d.converged), fd=u(d.freeData), obs=u(d.obs), target=u(d.target), name=d.d, factor=u(d.factor), solution=u(d.solution), mask=u(d.passive);
        return `
        @compute @workgroup_size(64) fn diagonal_${name}(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x/${m};let j=id.x%${m};if(c>=CHAINS){return;}let b=c*NW;let off=u32(dat[${fd}+2u*j+1u]);var a=0.0;var r=0.0;for(var i=0u;i<${n};i++){let v=col[c*NC+off+i];let w=dat[${obs}+3u*i+2u];a+=w*v*v;r+=w*v*work[b+${target}+i];}let s=sqrt(max(0.0,a));work[b+${scale}+j]=s;work[b+${rhs}+j]=select(0.0,r/max(1e-30,s),s>0.0);work[b+${grad}+j]=work[b+${rhs}+j];work[b+${x}+j]=0.0;if(j==0u){work[b+${conv}]=0.0;}}
        @compute @workgroup_size(64) fn normal_${name}(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x/(${m}*${m});let jk=id.x%(${m}*${m});if(c>=CHAINS){return;}let j=jk/${m};let k=jk%${m};let b=c*NW;let sj=work[b+${scale}+j];let sk=work[b+${scale}+k];var v=0.0;if(sj>0.0 && sk>0.0){let a=u32(dat[${fd}+2u*j+1u]);let z=u32(dat[${fd}+2u*k+1u]);for(var i=0u;i<${n};i++){v+=(col[c*NC+a+i]/sj)*(col[c*NC+z+i]/sk)*dat[${obs}+3u*i+2u];}}work[b+${H}+jk]=v;}
        @compute @workgroup_size(1) fn solve_${name}(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x;if(c>=CHAINS){return;}let b=c*NW;if(work[b+${conv}]>0.5){return;}
            for(var cycle=0u;cycle<8u;cycle++){for(var j=0u;j<${m};j++){let diag=work[b+${H}+j*${m}+j];if(diag<=0.0){continue;}let old=work[b+${x}+j];let next=max(0.0,old+work[b+${grad}+j]/diag);let delta=next-old;work[b+${x}+j]=next;if(delta!=0.0){for(var k=0u;k<${m};k++){work[b+${grad}+k]-=work[b+${H}+k*${m}+j]*delta;}}}}
            var err=0.0;var magnitude=1.0;for(var j=0u;j<${m};j++){var g=work[b+${rhs}+j];for(var k=0u;k<${m};k++){g-=work[b+${H}+j*${m}+k]*work[b+${x}+k];}work[b+${grad}+j]=g;magnitude=max(magnitude,abs(work[b+${rhs}+j]));err=max(err,select(max(0.0,g),abs(g),work[b+${x}+j]>0.0));}
            work[b+${conv}]=-err/magnitude;if(err<=1e-5*magnitude){work[b+${conv}]=1.0;}
        }
        // Active-set polish of the feasible coordinate-descent solution. Broad
        // overlapping peaks can make coordinate descent converge very slowly.
        @compute @workgroup_size(1) fn polish_${name}(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x;if(c>=CHAINS){return;}let b=c*NW;if(work[b+${conv}]>0.5){return;}
            for(var j=0u;j<${m};j++){work[b+${mask}+j]=select(0.0,1.0,work[b+${x}+j]>0.0);}
            var magnitude=1.0;for(var j=0u;j<${m};j++){magnitude=max(magnitude,abs(work[b+${rhs}+j]));}let tol=1e-5*magnitude;
            for(var iteration=0u;iteration<8u;iteration++){
                for(var i=0u;i<${m};i++){
                    for(var j=0u;j<=i;j++){
                        var a=0.0;if(work[b+${mask}+i]>0.5 && work[b+${mask}+j]>0.5){a=work[b+${H}+i*${m}+j];for(var k=0u;k<j;k++){a-=work[b+${factor}+i*${m}+k]*work[b+${factor}+j*${m}+k];}}
                        if(i==j){work[b+${factor}+i*${m}+j]=select(1.0,sqrt(max(1e-7,a)),work[b+${mask}+i]>0.5);}else{work[b+${factor}+i*${m}+j]=a/work[b+${factor}+j*${m}+j];}
                    }
                    var a=select(0.0,work[b+${rhs}+i],work[b+${mask}+i]>0.5);for(var j=0u;j<i;j++){a-=work[b+${factor}+i*${m}+j]*work[b+${solution}+j];}work[b+${solution}+i]=a/work[b+${factor}+i*${m}+i];
                }
                for(var count=0u;count<${m};count++){let i=${m}-1u-count;var a=work[b+${solution}+i];for(var j=i+1u;j<${m};j++){a-=work[b+${factor}+j*${m}+i]*work[b+${solution}+j];}work[b+${solution}+i]=a/work[b+${factor}+i*${m}+i];}
                var alpha=1.0;var hit=-1;for(var j=0u;j<${m};j++){if(work[b+${mask}+j]>0.5 && work[b+${solution}+j]<=0.0){let old=work[b+${x}+j];let den=old-work[b+${solution}+j];let t=select(0.0,old/max(1e-30,den),den>0.0);if(hit<0 || t<alpha){alpha=t;hit=i32(j);}}}
                if(hit>=0){for(var j=0u;j<${m};j++){if(work[b+${mask}+j]>0.5){let next=max(0.0,work[b+${x}+j]+alpha*(work[b+${solution}+j]-work[b+${x}+j]));work[b+${x}+j]=next;if(next==0.0 && work[b+${solution}+j]<=0.0){work[b+${mask}+j]=0.0;}}}work[b+${x}+u32(hit)]=0.0;work[b+${mask}+u32(hit)]=0.0;continue;}
                for(var j=0u;j<${m};j++){work[b+${x}+j]=select(0.0,work[b+${solution}+j],work[b+${mask}+j]>0.5);}
                var err=0.0;var enter=-1;var violation=tol;for(var j=0u;j<${m};j++){var g=work[b+${rhs}+j];for(var k=0u;k<${m};k++){g-=work[b+${H}+j*${m}+k]*work[b+${x}+k];}work[b+${grad}+j]=g;err=max(err,select(max(0.0,g),abs(g),work[b+${x}+j]>0.0));if(work[b+${mask}+j]<0.5 && g>violation){violation=g;enter=i32(j);}}
                if(err<=tol){work[b+${conv}]=1.0;return;}if(enter<0){return;}work[b+${mask}+u32(enter)]=1.0;
            }
            for(var j=0u;j<${m};j++){var g=work[b+${rhs}+j];for(var k=0u;k<${m};k++){g-=work[b+${H}+j*${m}+k]*work[b+${x}+k];}work[b+${grad}+j]=g;}
        }`;
    }

    // The shader helpers and generic PT kernels are kept together so a backend
    // change cannot accidentally select a different profile for one method.
    const SHADER = `
    const PI:f32=${f(Math.PI)}; const RAD:f32=${f(Math.PI/180)}; const BIG:f32=3e38;
    const GCONV:f32=${f(GSAS_GAUSSIAN_TO_DEG)}; const LCONV:f32=${f(GSAS_LORENTZIAN_TO_DEG)};
    const GAREA:f32=${f(PV_GAUSS_AREA)}; const LAREA:f32=${f(PV_LORENTZ_AREA)};
    const G0:f32=${f(PV_G0)}; const L0:f32=${f(PV_L0)};
    const WINDOW_G:f32=${f(CALCULATION_WINDOW_MULTIPLIER_G)}; const WINDOW_L:f32=${f(CALCULATION_WINDOW_MULTIPLIER_L)}; const WINDOW_MAX:f32=${f(PROFILE_WINDOW_MAX_DEG)};
    struct Metric {g:mat3x3<f32>,cart:mat3x3<f32>,valid:f32}
    struct Peak {center:f32,hg:f32,hl:f32,cl:f32,hgr:f32,hlr:f32,clr:f32,radius:f32,pedestal:f32,asym:f32,area:f32,height:f32}
    @group(0) @binding(0) var<storage,read_write> state:array<f32>;
    @group(0) @binding(1) var<storage,read> dat:array<f32>;
    @group(0) @binding(2) var<storage,read_write> peaks:array<Peak>;
    @group(0) @binding(3) var<storage,read_write> col:array<f32>;
    @group(0) @binding(4) var<storage,read_write> work:array<f32>;
    fn sq(x:f32)->f32{return x*x;}
    fn finite(x:f32)->bool{return abs(x)<BIG;}
    fn cdeg(x:f32)->f32{if(x==90.0){return 0.0;}if(x==120.0){return -0.5;}return cos(x*RAD);}
    fn metric(a:f32,b:f32,c:f32,al:f32,be:f32,ga:f32)->Metric{
        let ca=cdeg(al);let cb=cdeg(be);let cg=cdeg(ga);let sg=sin(ga*RAD);let vf=1.0-ca*ca-cb*cb-cg*cg+2.0*ca*cb*cg;
        if(min(a,min(b,c))<=0.0 || vf<=1e-9 || abs(sg)<1e-9){return Metric(mat3x3<f32>(),mat3x3<f32>(),0.0);}
        let av=vec3<f32>(a,0.0,0.0);let bv=vec3<f32>(b*cg,b*sg,0.0);let cv=vec3<f32>(c*cb,c*(ca-cb*cg)/sg,c*sqrt(vf)/sg);let vol=a*b*c*sqrt(vf);
        let cart=mat3x3<f32>(cross(bv,cv)/vol,cross(cv,av)/vol,cross(av,bv)/vol);return Metric(transpose(cart)*cart,cart,1.0);
    }
    fn angle2(g:Metric,n:vec3<f32>,axis:vec3<f32>)->f32{let a=g.cart*axis;return clamp(sq(dot(n,a)/max(1e-30,length(a))),0.0,1.0);}
    fn rotate(v:vec3<f32>,axis:u32,t:f32)->vec3<f32>{var r=v;let i=(axis+1u)%3u;let j=(axis+2u)%3u;r[i]=cos(t)*v[i]-sin(t)*v[j];r[j]=sin(t)*v[i]+cos(t)*v[j];return r;}
    fn positive(x:f32,b:f32)->f32{return 0.5*(x+sqrt(x*x+4.0*b*b));}
    fn gaussian(x:f32,b:f32)->f32{return sqrt(positive(x,sq(0.25*b/GCONV)))*GCONV;}
    fn lorentzian(x:f32,b:f32)->f32{return positive(x,0.25*b/LCONV)*LCONV;}
    fn softFloor(x:f32,b:f32)->f32{if(!finite(x)||x<=0.0){return b;}if(x>20.0*b){return x;}return b*pow(sq(sq(x/b))+1.0,0.25);}
    fn fwhm(g:f32,l:f32)->f32{let v=pow(g,5.0)+2.69269*pow(g,4.0)*l+2.42843*pow(g,3.0)*l*l+4.47163*g*g*pow(l,3.0)+0.07842*g*pow(l,4.0)+pow(l,5.0);return max(1e-6,pow(max(0.0,v),0.2));}
    fn mixing(eta:f32,g:f32,l:f32)->f32{let wl=eta*L0/max(1e-12,l);let wg=(1.0-eta)*G0/max(1e-12,g);return wl/(wl+wg);}
    fn raw(delta:f32,pk:Peak)->f32{var z=delta;if(pk.asym!=0.0 && abs(z)>=1e-9){z/=1.0-clamp(pk.asym*z,-0.95,0.95);}let g=select(pk.hg,pk.hgr,z>=0.0);let l=select(pk.hl,pk.hlr,z>=0.0);let c=select(pk.cl,pk.clr,z>=0.0);return c/(1.0+4.0*sq(z/l))+(1.0-c)*exp(-2.772588722239781*sq(z/g));}
    fn profile(t:f32,pk:Peak)->f32{let delta=t-pk.center;if(pk.radius<=0.0 || abs(delta)>pk.radius){return 0.0;}return max(0.0,raw(delta,pk)-pk.pedestal);}
    fn makePeak(tc:f32,center:f32,w:vec2<f32>,left:vec2<f32>,right:vec2<f32>,kind:u32,eta0:f32,asym0:f32)->Peak{
        var pk:Peak;pk.center=center;pk.hg=w.x;pk.hl=w.y;var eta=clamp(eta0,0.0,1.0);var width=fwhm(w.x,w.y);
        if(kind==2u){pk.hg=left.x;pk.hl=left.y;pk.hgr=right.x;pk.hlr=right.y;width=max(fwhm(left.x,left.y),fwhm(right.x,right.y));pk.cl=mixing(eta,left.x,left.y);pk.clr=mixing(eta,right.x,right.y);}
        else{if(kind==3u){let r=w.y/width;eta=clamp(1.36603*r-0.47719*r*r+0.11116*r*r*r,0.0,1.0);pk.hg=width;pk.hl=width;}pk.cl=mixing(eta,pk.hg,pk.hl);pk.hgr=pk.hg;pk.hlr=pk.hl;pk.clr=pk.cl;}
        pk.area=0.5*(pk.cl*LAREA*pk.hl+(1.0-pk.cl)*GAREA*pk.hg+pk.clr*LAREA*pk.hlr+(1.0-pk.clr)*GAREA*pk.hgr);
        if(kind==3u && tc>=0.1 && tc<180.0){pk.asym=asym0;}pk.radius=min(WINDOW_MAX,(WINDOW_G+(WINDOW_L-WINDOW_G)*eta)*max(0.01,width)*select(1.0,2.0,pk.asym!=0.0));pk.pedestal=max(raw(pk.radius,pk),raw(-pk.radius,pk));return pk;
    }
    fn shift(t:f32,disp:f32,transp:f32)->f32{let theta=t*RAD*0.5;if(abs(theta-PI*0.5)<1e-6){return 0.0;}return (-disp*0.001*cos(theta)+transp*sin(2.0*theta))/RAD;}
    fn lp(t:f32,k:f32)->f32{if(t<=0.0 || t>=180.0){return 1.0;}let th=t*RAD*0.5;let s=sin(th);let c=cos(th);if(s<1e-6 || c<1e-6){return 1.0;}return (1.0+k*sq(cos(t*RAD)))/((1.0+k)*s*s*c);}
    /*GENERATED*/
    fn random(seed:ptr<function,u32>)->f32{var v=*seed;v^=v<<13u;v^=v>>17u;v^=v<<5u;*seed=v;return clamp((f32(v)+0.5)/4294967296.0,1e-7,0.9999999);}
    fn rng(c:u32,sweep:u32)->u32{var z=SEED^(c*747796405u+2891336453u)^(sweep*277803737u);z=(z^(z>>16u))*2246822519u;return (z^(z>>13u))|1u;}
    fn reflect(v:f32,lo:f32,hi:f32)->f32{if(lo>-2.9e38 && hi<2.9e38){let span=hi-lo;if(span<=0.0){return lo;}let r=v-lo-floor((v-lo)/(2.0*span))*(2.0*span);return lo+select(2.0*span-r,r,r<=span);}if(v<lo){return 2.0*lo-v;}if(v>hi){return 2.0*hi-v;}return v;}
    @compute @workgroup_size(64) fn propose(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x;if(c>=CHAINS){return;}let b=c*STRIDE;for(var j=0u;j<NV;j++){state[b+NV+j]=state[b+j];}let sweep=state[b+3u*NV+2u];if(sweep>=0.0){var seed=rng(c,u32(sweep));let j=min(NV-1u,u32(random(&seed)*f32(NV)));let z=sqrt(-2.0*log(random(&seed)))*cos(2.0*PI*random(&seed));let temp=pow(MAX_TEMP,f32(c)/f32(CHAINS-1u));state[b+NV+j]=reflect(state[b+j]+z*dat[BOUNDS+3u*j+2u]*sqrt(temp),dat[BOUNDS+3u*j],dat[BOUNDS+3u*j+1u]);state[b+3u*NV+8u]=log(random(&seed));}state[b+3u*NV+7u]=select(0.0,1.0,valid(c));}
    var<workgroup> partial:array<f32,64>;
    @compute @workgroup_size(64) fn energy(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){let c=group.x;var result=0.0;for(var i=lane;i<NP;i+=64u){result+=pointEnergy(c,i);}partial[lane]=result;workgroupBarrier();for(var step=32u;step>0u;step/=2u){if(lane<step){partial[lane]+=partial[lane+step];}workgroupBarrier();}if(lane==0u){let b=c*STRIDE;var cost=partial[0];if(state[b+3u*NV+7u]<0.5 || !finite(cost)){cost=BIG;}if(state[b+3u*NV+7u]>0.5 && !solved(c)){state[b+3u*NV+9u]=1.0;cost=BIG;}state[b+3u*NV+10u]=cost;}}
    @compute @workgroup_size(64) fn accept(@builtin(global_invocation_id) id:vec3<u32>){let c=id.x;if(c>=CHAINS){return;}let b=c*STRIDE;let sweep=state[b+3u*NV+2u];let cost=state[b+3u*NV+10u];let old=state[b+3u*NV];let temp=pow(MAX_TEMP,f32(c)/f32(CHAINS-1u));if(sweep<0.0 || (cost<BIG && (cost<=old || state[b+3u*NV+8u]<(old-cost)/(2.0*temp)))){for(var j=0u;j<NV;j++){state[b+j]=state[b+NV+j];}state[b+3u*NV]=cost;if(sweep>=0.0){state[b+3u*NV+3u]+=1.0;}if(sweep<0.0 || cost<state[b+3u*NV+1u]){for(var j=0u;j<NV;j++){state[b+2u*NV+j]=state[b+NV+j];}state[b+3u*NV+1u]=cost;}}if(sweep>=0.0){state[b+3u*NV+4u]+=1.0;}state[b+3u*NV+2u]=sweep+1.0;}
    @compute @workgroup_size(64) fn exchange(@builtin(global_invocation_id) id:vec3<u32>){let parity=u32(state[3u*NV+2u]-1.0)%2u;let c=2u*id.x+parity;if(c+1u>=CHAINS){return;}let b=c*STRIDE;let z=(c+1u)*STRIDE;let t0=pow(MAX_TEMP,f32(c)/f32(CHAINS-1u));let t1=pow(MAX_TEMP,f32(c+1u)/f32(CHAINS-1u));let a=0.5*(1.0/t0-1.0/t1)*(state[b+3u*NV]-state[z+3u*NV]);var seed=rng(c,u32(state[b+3u*NV+2u])+2147483647u);state[b+3u*NV+6u]+=1.0;if(a>=0.0 || log(random(&seed))<a){for(var j=0u;j<NV;j++){let v=state[b+j];state[b+j]=state[z+j];state[z+j]=v;}let v=state[b+3u*NV];state[b+3u*NV]=state[z+3u*NV];state[z+3u*NV]=v;state[b+3u*NV+5u]+=1.0;}}
    `;

    function timeout(promise, label, ms=20000) {
        let timer; return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WebGPU PT timed out during '+label+'.')),ms);})]).finally(()=>clearTimeout(timer));
    }
    async function create(ctx, options) {
        options=options||{};
        if(!options.device && (!root.navigator || !root.navigator.gpu))throw new Error('WebGPU is unavailable in this browser or context.');
        let device=options.device;
        if(!device){const adapter=await timeout(root.navigator.gpu.requestAdapter(),'adapter request');if(!adapter)throw new Error('No WebGPU adapter is available.');device=await timeout(adapter.requestDevice(),'device request');}
        const buffers=[],errors=[]; let lost=null;
        device.lost.then(info=>{lost=info.message||info.reason||'device lost';});
        const onError=e=>{if(e.preventDefault)e.preventDefault();errors.push(e.error && e.error.message || 'WebGPU validation error');};
        device.addEventListener('uncapturederror',onError);
        function check(){if(lost)throw new Error('WebGPU PT device lost: '+lost);if(errors.length)throw new Error(errors[0]);}
        function buffer(bytes,usage,initial){if(bytes>device.limits.maxStorageBufferBindingSize || bytes>device.limits.maxBufferSize)throw new Error('PT buffers exceed this GPU\'s storage limits.');const b=device.createBuffer({size:Math.max(4,bytes),usage});buffers.push(b);if(initial)device.queue.writeBuffer(b,0,initial);return b;}
        function close(){buffers.forEach(b=>b.destroy());device.removeEventListener('uncapturederror',onError);if(!options.device)device.destroy();}
        try{
            const plan=compile(ctx), usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
            const sb=buffer(plan.chains*plan.stride*4,usage), db=buffer(plan.data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,plan.data);
            const pb=buffer(plan.chains*plan.reflectionCount*2*48,usage), cb=buffer(plan.chains*plan.columnCount*4,usage), wb=buffer(plan.chains*plan.workCount*4,usage);
            const read=buffer(plan.chains*plan.stride*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
            const module=device.createShaderModule({code:plan.shader,label:'Powder6 PT'}), messages=await timeout(module.getCompilationInfo(),'shader compilation');
            const bad=messages.messages.filter(m=>m.type==='error');if(bad.length)throw new Error('WebGPU PT shader: '+bad.map(m=>m.message+' (line '+m.lineNum+')').join('; '));
            const layout=device.createBindGroupLayout({entries:[0,1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===1?'read-only-storage':'storage'}}))});
            const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
            const names=['propose','geometry','columns','targets','energy','accept','exchange'];
            plan.datasets.filter(d=>d.m).forEach(d=>names.push('diagonal_'+d.d,'normal_'+d.d,'solve_'+d.d,'polish_'+d.d));
            const pipelines={};await Promise.all(names.map(async entryPoint=>{pipelines[entryPoint]=await timeout(device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}}),'pipeline creation');}));
            const group=device.createBindGroup({layout,entries:[sb,db,pb,cb,wb].map((resource,binding)=>({binding,resource:{buffer:resource}}))});
            const dispatch=(encoder,name,n,grouped=false)=>{if(!n)return;const count=grouped?n:Math.ceil(n/64),width=Math.min(65535,count),height=Math.ceil(count/width);if(height>device.limits.maxComputeWorkgroupsPerDimension)throw new Error('PT dispatch exceeds this GPU\'s workgroup limit.');const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(width,height);pass.end();};
            function evaluate(encoder){dispatch(encoder,'geometry',plan.chains*plan.reflectionCount);dispatch(encoder,'columns',plan.chains*plan.columnCount);dispatch(encoder,'targets',plan.chains*plan.pointCount);
                plan.datasets.filter(d=>d.m).forEach(d=>{dispatch(encoder,'diagonal_'+d.d,plan.chains*d.m);dispatch(encoder,'normal_'+d.d,plan.chains*d.m*d.m);for(let j=0;j<8;j++){dispatch(encoder,'solve_'+d.d,plan.chains,true);dispatch(encoder,'polish_'+d.d,plan.chains,true);}});dispatch(encoder,'energy',plan.chains,true);}
            async function snapshot(encoder){encoder.copyBufferToBuffer(sb,0,read,0,plan.chains*plan.stride*4);device.queue.submit([encoder.finish()]);await timeout(read.mapAsync(GPUMapMode.READ),'readback');let result;try{result=new Float32Array(read.getMappedRange().slice(0));}finally{read.unmap();}check();return result;}
            function initial(vectors){const values=new Float32Array(plan.chains*plan.stride);for(let c=0;c<plan.chains;c++){const b=c*plan.stride,v=vectors[c%vectors.length];values.set(v,b);values.set(v,b+plan.nv);values.set(v,b+2*plan.nv);values[b+3*plan.nv]=3e38;values[b+3*plan.nv+1]=3e38;values[b+3*plan.nv+2]=-1;values[b+3*plan.nv+7]=1;}device.queue.writeBuffer(sb,0,values);}
            return {plan,close,initial,
                async costs(vectors){initial(vectors);const e=device.createCommandEncoder();dispatch(e,'propose',plan.chains);evaluate(e);const state=await snapshot(e);return Array.from({length:plan.chains},(_,c)=>{const b=c*plan.stride+3*plan.nv;if(state[b+9])throw new Error('WebGPU PT intensity solve did not converge.');return state[b+10];});},
                async batch(count,bootstrap){check();const e=device.createCommandEncoder();for(let j=0;j<count;j++){dispatch(e,'propose',plan.chains);evaluate(e);dispatch(e,'accept',plan.chains);if(!bootstrap)dispatch(e,'exchange',Math.ceil(plan.chains/2));}return snapshot(e);}
            };
        }catch(e){close();throw e;}
    }

    function reflected(value,lo,hi){if(Number.isFinite(lo)&&Number.isFinite(hi)){const span=hi-lo;if(span<=0)return lo;const folded=((value-lo)%(2*span)+2*span)%(2*span);return lo+(folded<=span?folded:2*span-folded);}return value<lo?2*lo-value:value>hi?2*hi-value:value;}
    async function run(ctx) {
        let gpu;
        try{
            gpu=await create(ctx);
            const probes=[Array.from(ctx.x),Array.from(ctx.x,(v,j)=>reflected(v+ctx.setup.scales[j]*0.25,ctx.info[j].lo,ctx.info[j].hi))];
            const gc=await gpu.costs(probes);let validationError=0;
            for(let c=0;c<ctx.setup.chains;c++){const cpu=ctx.cost(probes[c%probes.length]);if(!Number.isFinite(cpu))continue;const error=Math.abs(gc[c]-cpu)/Math.max(1,cpu);validationError=Math.max(validationError,error);if(!Number.isFinite(gc[c])||error>0.001)throw new Error('WebGPU PT cost disagrees with the double-precision model (relative error '+error.toPrecision(3)+').');}
            gpu.initial([ctx.x]);let state=await gpu.batch(1,true), best=Float64Array.from(ctx.x), bestCost=ctx.setup.initialCost, completed=0, stopped=false;
            const seen=new Set();
            function inspect(){for(let c=0;c<ctx.setup.chains;c++){const b=c*gpu.plan.stride,n=ctx.x.length;if(state[b+3*n+9])throw new Error('WebGPU PT intensity solve did not converge; restarting CPU PT.');const candidate=Array.from(state.subarray(b+2*n,b+3*n)),key=candidate.join(',');if(seen.has(key))continue;seen.add(key);if(!candidate.every((v,j)=>Number.isFinite(v)&&v>=ctx.info[j].lo&&v<=ctx.info[j].hi))continue;const value=ctx.cost(candidate);if(value<bestCost){best=Float64Array.from(candidate);bestCost=value;}}}
            while(completed<ctx.setup.sweeps){if(ctx.shouldStop && ctx.shouldStop()){stopped=true;break;}const count=Math.min(8,ctx.setup.sweeps-completed);state=await gpu.batch(count,false);completed+=count;inspect();ctx.onIter({it:completed,chi2:bestCost,maxIter:ctx.maxIter,stage:'pt',backend:'webgpu'});}
            const stats={accepted:0,proposals:0,swaps:0,swapAttempts:0};for(let c=0;c<ctx.setup.chains;c++){const b=c*gpu.plan.stride+3*ctx.x.length;stats.accepted+=state[b+3];stats.proposals+=state[b+4];stats.swaps+=state[b+5];stats.swapAttempts+=state[b+6];}
            return {x:best,stopped,pt:Object.assign({backend:'webgpu',chains:ctx.setup.chains,sweeps:completed,requestedSweeps:ctx.setup.sweeps,maxTemp:ctx.setup.maxTemp,seed:ctx.setup.seed,initialChi2:ctx.setup.initialCost,bestChi2:bestCost,validationError},stats)};
        }finally{if(gpu)gpu.close();}
    }
    root.RVPTGPU={compile,create,run};
})(typeof self!=='undefined'?self:globalThis);
