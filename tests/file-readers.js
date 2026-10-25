(async function(){
  'use strict';
  // The XML readers (XRDML, BRML) need DOMParser, so they are tested here rather than in the Node suite.
  const out=document.getElementById('results'),results=[];
  function check(ok,msg){if(!ok)throw Error(msg);}
  function record(name){results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);}
  const near=(a,b)=>Math.abs(a-b)<1e-9;
  const xrdml=scans=>'<?xml version="1.0" encoding="UTF-8"?>\n<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/1.5"><xrdMeasurement measurementType="Scan">'+
    '<usedWavelength intended="K-Alpha 1"><kAlpha1 unit="Angstrom">1.5405980</kAlpha1><kAlpha2 unit="Angstrom">1.5444260</kAlpha2><ratioKAlpha2KAlpha1>0.5000</ratioKAlpha2KAlpha1></usedWavelength>'+
    scans.map(s=>'<scan><dataPoints>'+s+'<commonCountingTime unit="seconds">1.0</commonCountingTime></dataPoints></scan>').join('')+'</xrdMeasurement></xrdMeasurements>';
  const range=(a,b,ints)=>'<positions axis="2Theta" unit="deg"><startPosition>'+a+'</startPosition><endPosition>'+b+'</endPosition></positions><intensities unit="counts">'+ints+'</intensities>';
  try{
    let p=normalizeParsedData(detectAndParseFile('a.xrdml',xrdml([range(10,10.04,'5 6 7')])),'a.xrdml');
    check(p.tth.length===3 && near(p.tth[2],10.04) && p.intensity[1]===6,'XRDML start/end scan misread');
    check(p.wavelength===1.540598 && p.wavelength2===1.544426 && p.ratio21===.5,'XRDML Ka2 or ratio not read');record('XRDML start/end positions with Ka1, Ka2 and ratio');
    p=detectAndParseFile('b.xrdml',xrdml(['<positions axis="2Theta" unit="deg"><listPositions>10 10.03 10.07</listPositions></positions><intensities unit="counts">5 6 7</intensities>']));
    check(p.tth.join()==='10,10.03,10.07' && p.intensity.join()==='5,6,7','XRDML listPositions not read');record('XRDML listPositions');
    p=detectAndParseFile('c.xrdml',xrdml([range(10,10.02,'5 6'),range(20,20.02,'8 9')]));
    check(p.patterns?.length===2 && p.patterns[1].tth[0]===20 && p.patterns[1].intensity.join()==='8,9','XRDML second scan lost');record('XRDML with two scans gives two patterns');
    const datum=(axis,rows)=>'<?xml version="1.0" encoding="utf-8"?><RawData><FixedInformation><Instrument><WaveLengthAlpha1 Value="1.5406" Unit="Angstrom"/><WaveLengthAlpha2 Value="1.54439" Unit="Angstrom"/><WaveLengthRatio Value="0.5"/></Instrument></FixedInformation>'+
      '<DataRoutes><DataRoute RouteFlag="Final"><ScanInformation>'+axis+'</ScanInformation>'+rows.map(r=>'<Datum>'+r+'</Datum>').join('')+'</DataRoute></DataRoutes></RawData>';
    const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');
    zip.file('Experiment0/RawData0.xml',datum('<ScaleAxes><ScaleAxisInfo AxisId="TwoTheta"><Start>5</Start><Stop>5.04</Stop><Increment>0.02</Increment></ScaleAxisInfo></ScaleAxes>',['1,1,5.000,2.500,120','1,1,5.020,2.510,130','1,1,5.040,2.520,125']));
    p=normalizeParsedData(await detectAndParseBuffer('a.brml',await zip.generateAsync({type:'arraybuffer'})),'a.brml');
    check(p.tth.length===3 && near(p.tth[2],5.04) && p.intensity.join()==='120,130,125','BRML Datum records misread');
    check(p.wavelength===1.5406 && p.wavelength2===1.54439 && p.ratio21===.5,'BRML wavelengths not read');record('BRML archive with Datum records, axis block and wavelengths');
    p=detectAndParseFile('RawData0.xml',datum('',['1,1,7.000,3.500,10','1,1,7.050,3.525,11']).replace('<RawData>','<RawData><RawDataFile/>'));
    check(p.tth.join()==='7,7.05' && p.intensity.join()==='10,11','BRML 2-theta column not used without an axis block');record('BRML Datum records without an axis block');
    p=parseBrukerBrmlFile('<?xml version="1.0"?><RawDataFile><startPosition axis="TwoTheta">10</startPosition><increment axis="TwoTheta">0.5</increment><dataPoints><counts>1 2 3</counts></dataPoints></RawDataFile>');
    check(p.tth.join()==='10,10.5,11' && p.intensity.join()==='1,2,3','BRML dataPoints layout no longer read');record('BRML dataPoints layout still read');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:String(e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
