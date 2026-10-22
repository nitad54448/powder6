/* Quality diagnostics and a bounded CF parameter search. The numerical cutoffs
 * below are explicit search heuristics, not calibrated probabilities of success.
 * No additional intensity cutoff. Shared overlap rules keep diagnostics,
 * CPU and GPU reflection models consistent. */
(function(root){
  'use strict';
  function median(values){var a=values.filter(Number.isFinite).slice().sort(function(x,y){return x-y;});return a.length?(a[(a.length-1)>>1]+a[a.length>>1])/2:null;}
  function overlap(a,b,options){
    var ta=a.tth,tb=b.tth,tol=options.overlapTolTth;
    if(Number.isFinite(ta) && Number.isFinite(tb)){
      if(options.overlapFwhmFraction>0 && a.fwhm>0 && b.fwhm>0 && Number.isFinite(a.fwhm+b.fwhm))tol=options.overlapFwhmFraction*(a.fwhm+b.fwhm)/2;
      return Math.abs(tb-ta)<=(Number.isFinite(tol)?tol:.05);
    }
    return a.d>0 && b.d>0 && Math.abs(a.d-b.d)<=1e-4*a.d;
  }
  function assess(I,options,widthOf){
    options=options || {};var source=I && I.det || [],rows=source.filter(function(r){return Number.isFinite(r.area);}).map(function(r){
      var width=r.fwhm;if(!(width>0) && widthOf){try{width=widthOf(r);}catch(e){width=null;}}
      return Object.assign({},r,{fwhm:Number.isFinite(width) && width>0?width:null});
    });
    rows.sort(function(a,b){return (Number.isFinite(a.tth)?a.tth:1/a.d)-(Number.isFinite(b.tth)?b.tth:1/b.d);});
    var n=rows.length,resolved=rows.filter(function(r){return !(r.group>=0);}),withSigma=resolved.filter(function(r){return r.sigma>0 && Number.isFinite(r.sigma);}),snr=withSigma.map(function(r){return r.area/r.sigma;}),groups=0;
    var grouping={overlapTolTth:Number.isFinite(options.overlapTol)?options.overlapTol:.05,overlapFwhmFraction:.5};
    rows.forEach(function(r,i){if(!i || !overlap(rows[i-1],r,grouping))groups++;});
    var ds=rows.map(function(r){return r.d;}).filter(function(d){return d>0 && Number.isFinite(d);}),strong=withSigma.filter(function(r){return r.area>=3*r.sigma;}),qValues=ds.map(function(d){return 1/(d*d);}),qMin=Math.min.apply(null,qValues),qMax=Math.max.apply(null,qValues);
    var shells=[0,1,2].map(function(k){var list=rows.filter(function(r){if(!(r.d>0))return false;var q=1/(r.d*r.d),bin=qMax>qMin?Math.min(2,Math.floor(3*(q-qMin)/(qMax-qMin))):0;return bin===k;}),usable=list.filter(function(r){return !(r.group>=0) && r.sigma>0 && Number.isFinite(r.sigma);});return {name:['Low angle','Middle','High angle'][k],count:list.length,sigmaCount:usable.length,medianISigma:median(usable.map(function(r){return r.area/r.sigma;}))};});
    var coverage=resolved.length?withSigma.length/resolved.length:0,reliable=!!I && I.covarianceOK===true && withSigma.length>=4 && coverage>=.8;
    var result={count:n,resolvedCount:resolved.length,clusters:groups,overlapFraction:n?1-groups/n:0,sigmaCoverage:coverage,uncertaintiesReliable:reliable,medianISigma:median(snr),strongCount:strong.length,
      dMin:ds.length?Math.min.apply(null,ds):null,strongDMin:null,widthCoverage:n?rows.filter(function(r){return r.fwhm>0;}).length/n:0,medianFwhm:median(rows.map(function(r){return r.fwhm;})),
      nonpositive:rows.filter(function(r){return r.area<=0 || r.bound;}).length,shells:shells,grouping:grouping};
    var strongDs=strong.map(function(r){return r.d;}).filter(function(d){return d>0 && Number.isFinite(d);});result.strongDMin=strongDs.length?Math.min.apply(null,strongDs):null;
    result.lowSignal=reliable && result.medianISigma<3;
    result.limitedResolution=result.dMin!=null && result.dMin>1.5;
    result.heavyOverlap=result.overlapFraction>.35;
    result.weakHighAngleData=reliable && shells[2].sigmaCount>=3 && shells[2].medianISigma<2;
    return {quality:result,rows:rows};
  }
  var MIN_STARTS=6,MAX_STARTS=128;
  function plan(assessment,starts,haveSymmetry){
    if(!Number.isSafeInteger(starts) || starts<MIN_STARTS || starts>MAX_STARTS)throw Error('Adaptive CF needs '+MIN_STARTS+'–'+MAX_STARTS+' random starts so each setting is tried with independent seeds.');
    var q=assessment.quality,reasons=[];
    if(q.lowSignal)reasons.push('low median I/σ');if(q.weakHighAngleData)reasons.push('weak high-angle shell');if(q.limitedResolution)reasons.push('limited measured resolution');if(q.heavyOverlap)reasons.push('heavy profile overlap');if(!q.uncertaintiesReliable)reasons.push('uncertainties unavailable or conditional');
    var difficult=reasons.length>0;
    var settings=difficult?[{threshold:1,weakFraction:.25,symLambda:.5},{threshold:1.1,weakFraction:.15,symLambda:.5},{threshold:1.2,weakFraction:.25,symLambda:.75}]:
      [{threshold:1,weakFraction:.1,symLambda:0},{threshold:1.1,weakFraction:.15,symLambda:.5},{threshold:1.2,weakFraction:.2,symLambda:.5}];
    settings.forEach(function(s,i){s.id=i+1;if(!haveSymmetry)s.symLambda=0;s.starts=0;});
    var trials=[];for(var i=0;i<starts;i++){var setting=settings[i%settings.length];setting.starts++;trials.push(Object.assign({},setting,{seedSlot:Math.floor(i/settings.length)}));}
    return {version:1,quality:q,settings:settings,trials:trials,grouping:q.grouping,difficult:difficult,reasons:reasons};
  }
  var api={median:median,overlap:overlap,assess:assess,plan:plan,MIN_STARTS:MIN_STARTS,MAX_STARTS:MAX_STARTS};root.CFAdaptive=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
