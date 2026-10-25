// Updated for Powder 5 version 179, 5 October 2026.
// ---------------------------------------------------------------------------
//  ZIP CONTAINERS
//
//  .brml (Bruker) and .rasx (Rigaku) are not XML files. They are ZIP archives
//  with XML and text INSIDE them, and the loader read every file as text -- so
//  a .brml arrived as the raw deflate stream, its extension matched the BRML
//  rule, DOMParser was handed binary and threw, and the file fell through to
//  the two-column fallback which found nothing. The registry entry for .rasx
//  additionally routed to the BRML parser, which would not have worked even on
//  an unzipped one: RASX keeps its intensities in a plain text profile, not in
//  the XML at all.
//
//  Requires lib/jszip.min.js. Without it the archive formats are refused with
//  a message that says so, rather than failing as a parse error.
// ---------------------------------------------------------------------------

/** ZIP local file header magic, "PK\x03\x04". */
const isZipBuffer = (buf) => {
    const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
};

/**
 * Bytes to text, without mangling the legacy formats.
 *
 * Most instrument text files are ASCII, but the older ones carry degree signs
 * and micro symbols in a single-byte codepage. Strict UTF-8 would reject those
 * bytes and lenient UTF-8 turns them into replacement characters, so a failed
 * UTF-8 decode falls back to windows-1252 rather than keeping the damage.
 */
const decodeTextBuffer = (buf) => {
    // UTF-16 (some Windows exports): with a BOM, or without one when every
    // other byte of the start is zero. Read as UTF-8 it is a NUL between every
    // character, which no reader can parse and which looked like a binary file.
    const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096));
    let utf16 = head[0] === 0xFF && head[1] === 0xFE ? 'utf-16le' : head[0] === 0xFE && head[1] === 0xFF ? 'utf-16be' : null;
    if (!utf16 && head.length >= 8) {
        let even = 0, odd = 0;
        for (let i = 0; i < head.length; i++) if (head[i] === 0) { if (i % 2) odd++; else even++; }
        if (odd > head.length / 4 && even === 0) utf16 = 'utf-16le';
        else if (even > head.length / 4 && odd === 0) utf16 = 'utf-16be';
    }
    if (utf16) {
        try { return new TextDecoder(utf16).decode(buf); } catch (e) { /* fall through */ }
    }
    let s = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (s.indexOf('\uFFFD') >= 0) {
        try { s = new TextDecoder('windows-1252').decode(buf); } catch (e) { /* keep utf-8 */ }
    }
    return s;
};

/**
 * Pull a wavelength out of whatever XML an archive happens to carry.
 *
 * Every vendor spells it differently and the surrounding schema is large, so
 * this looks for the number rather than the structure. Bounded to 0.3-3.0 A:
 * that covers every laboratory anode and neutron instrument, and rejects the
 * unrelated numbers -- goniometer radii, slit widths, timestamps -- that a
 * looser pattern would pick up.
 */
const sniffWavelengthFromXml = (xml) => {
    const pats = [
        /kAlpha1[^0-9\-]{0,40}([0-9]*\.[0-9]+)/i,
        // Bruker: <WaveLengthAlpha1 Value="1.5406" .../>. The generic pattern
        // below stops at the "1" of "Alpha1" and never reaches the value.
        /WaveLengthAlpha1[^>]*?Value="([0-9]*\.[0-9]+)"/i,
        /<Wavelength[^>]*>\s*([0-9]*\.[0-9]+)/i,
        /Wavelength[^0-9\-]{0,40}([0-9]*\.[0-9]+)/i
    ];
    for (const p of pats) {
        const m = xml.match(p);
        if (m) {
            let v = parseFloat(m[1]);
            // Rigaku states it in nm in some files.
            if (v > 0.03 && v < 0.3) v *= 10;
            if (v >= 0.3 && v <= 3.0) return v;
        }
    }
    return null;
};

/**
 * Does this parse result actually hold plottable points?
 *
 * The acceptance tests below used to ask only `r.tth && r.tth.length`, which
 * an array of NaN passes. A container whose first RawData member has a
 * malformed startPosition therefore RETURNED that member -- length right,
 * every value non-finite -- and in returning it skipped every remaining entry
 * in the archive. normalizeParsedData then rejected it at the end of the load,
 * so a .brml holding one bad member and one good one failed outright, with an
 * error about the file having no usable points rather than about the member
 * that was broken.
 *
 * Two finite pairs, because that is what normalizeParsedData requires further
 * down; accepting anything less here only defers the same rejection. Scans the
 * whole array rather than sampling it: a header row parsed as a point puts the
 * only finite values at the front.
 */
const hasUsablePoints = (r) => {
    if (!r || !r.tth || !r.intensity) return false;
    const n = Math.min(r.tth.length, r.intensity.length);
    let good = 0;
    for (let i = 0; i < n; i++) {
        if (isFinite(r.tth[i]) && isFinite(r.intensity[i]) && ++good >= 2) return true;
    }
    return false;
};

/**
 * Parse an unzipped archive, given its entries as {name, text}.
 *
 * Tried in order of how specifically the entry names identify the vendor, so a
 * container that happens to hold several readable things is read as the format
 * it actually is rather than as whichever entry sorted first.
 *
 * @param {{name: string, text: string}[]} entries
 * @param {string} fileName
 */
const parseZipEntries = (entries, fileName) => {
    const xml = entries.filter(e => /\.xml$/i.test(e.name));
    const problems = [];

    //   Bruker BRML: the scan lives in Experiment*/RawData*.xml
    const raw = entries.filter(e => /rawdata.*\.xml$/i.test(e.name));
    for (const e of raw) {
        try {
            const r = parseBrukerBrmlFile(e.text);
            if (hasUsablePoints(r)) {
                if (!r.wavelength) {
                    for (const x of xml) {
                        const wl = sniffWavelengthFromXml(x.text);
                        if (wl) { r.wavelength = wl; break; }
                    }
                }
                return r;
            }
        } catch (err) { problems.push(`${e.name}: ${err.message}`); }
    }

    //   Rigaku RASX: intensities in Data*/Profile*.txt, conditions in XML
    const prof = entries.filter(e => /profile.*\.txt$/i.test(e.name));
    for (const e of prof) {
        try {
            const r = parseDataFile(e.text, `${fileName}:${e.name}`, { attenuation: true });
            if (hasUsablePoints(r)) {
                for (const x of xml) {
                    const wl = sniffWavelengthFromXml(x.text);
                    if (wl) { r.wavelength = wl; break; }
                }
                return r;
            }
        } catch (err) { problems.push(`${e.name}: ${err.message}`); }
    }

    //   An XRDML or anything else the ordinary detector recognises.
    for (const e of entries) {
        // Skip the metadata files every container carries; running the
        // two-column fallback over them yields a few stray numbers that look
        // like a one-point pattern.
        if (/(^|\/)(\[Content_Types\]|_rels|docProps)/i.test(e.name)) continue;
        try {
            const r = detectAndParseFile(e.name, e.text);
            if (hasUsablePoints(r)) return r;
        } catch (err) { problems.push(`${e.name}: ${err.message}`); }
    }

    throw new Error(
        `${fileName} is a ZIP archive, but none of its ${entries.length} entries ` +
        `held a readable powder scan.` +
        (problems.length ? ` Tried: ${problems.slice(0, 3).join('; ')}` : ''));
};

/**
 * The loader's entry point: bytes in, parsed pattern out.
 *
 * Async because unzipping is. Everything that is not an archive takes the same
 * synchronous path it always did, decoded from the buffer instead of being
 * handed to FileReader.readAsText.
 *
 * @param {string} fileName
 * @param {ArrayBuffer} buffer
 * @returns {Promise<object>}
 */
const detectAndParseBuffer = async (fileName, buffer) => {
    if (!isZipBuffer(buffer)) {
        const text = decodeTextBuffer(buffer);
        // A binary scan (Philips .rd/.sd, Bruker .raw, Rigaku .raw) decoded as
        // text keeps its NUL bytes. Said here, instead of letting a text reader
        // fail on it with a message about a missing section or column.
        if (text.substring(0, 4096).indexOf('\u0000') >= 0) {
            throw new Error(
                `${fileName} is a binary file, which Powder 6 does not read. ` +
                `Export the scan from the instrument software as .xy, .xrdml, .udf, .uxd or .ras.`);
        }
        return detectAndParseFile(fileName, text);
    }
    if (typeof JSZip === 'undefined') {
        throw new Error(
            `${fileName} is a ZIP archive (.brml and .rasx both are), and the unzip ` +
            `library is not loaded. Add lib/jszip.min.js, or unzip the file and open ` +
            `the RawData XML or Profile text inside it.`);
    }
    const zip = await JSZip.loadAsync(buffer);
    const entries = [];
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    for (const n of names) {
        // Only the text members are of interest; an embedded image or a
        // thumbnail decoded as text is megabytes of noise for the parsers to
        // walk through.
        if (!/\.(xml|txt|csv|dat|asc|raw|xrdml|ras|rels)$/i.test(n) && !/rawdata/i.test(n)) continue;
        entries.push({ name: n, text: await zip.files[n].async('string') });
    }
    if (!entries.length) {
        throw new Error(`${fileName} is a ZIP archive with no text entries to read.`);
    }
    return parseZipEntries(entries, fileName);
};

/**
         * Smart file detector. It checks for known headers and extensions
         * and falls back to a generic 2-column parser.
         */
        const detectAndParseFile = (fileName, fileContent) => {
            const name = fileName.toLowerCase();
            const lines = fileContent.trim().split(/\r?\n/);
            const firstLine = lines.length > 0 ? lines[0].trim() : '';
            const upperContent = fileContent.substring(0, 500).toUpperCase(); // Check first 500 chars

            //   Parser Registry  
            const PARSER_REGISTRY = [
                { // pdCIF -- must be tested BEFORE the generic fallback, and
                  // before the XML tests, since a CIF is neither XML nor two
                  // columns and the fallback would read its loop headers as data.
                    // [._], not _: cif_pd 2.5.0 names are _pd_meas.2theta_scan,
                    // which is what writePdCIF() emits, so the old /_pd_(meas|proc)_/
                    // did not recognise this program's own output once the file
                    // lost its .cif extension. _pd_calc covers a simulation, which
                    // has no measured column. Case-insensitive: CIF names are.
                    test: (name, content) => name.endsWith('.cif') ||
                                             /\bdata_/i.test(content) &&
                                             /_pd_(meas|proc|calc)[._]/i.test(content),
                    // A .cif that is not a powder profile (a structure CIF, say)
                    // must report the reader's error. Falling through let the
                    // two-column fallback read atom coordinates as a pattern.
                    fatal: () => true,
                    // RETURNED WHOLE, NOT WHITELISTED.
                    //
                    // This used to rebuild the result as
                    //     { tth, intensity, wavelength, zeroShift }
                    // which silently discarded everything else the reader had
                    // extracted -- the cell, the space group, the Ka2
                    // wavelength and its ratio, the profile function and its
                    // parameters, the polarisation model. A pdCIF written by
                    // this program therefore round-tripped its pattern, its
                    // wavelength and its zero point, and threw away the entire
                    // refinement that had produced them, with nothing anywhere
                    // reporting a loss.
                    //
                    // A whitelist here is the wrong shape of code: it has to be
                    // edited every time the reader learns a new tag, and the
                    // failure when someone forgets is invisible. parsePdCifFile
                    // already returns exactly the fields it means to return, so
                    // this hands them on untouched. normalizeParsedData() below
                    // spreads the object rather than rebuilding it, so they
                    // survive the rest of the way.
                    parser: (content) => {
                        const patterns = parsePdCifFiles(content);
                        return patterns.length > 1 ? { ...patterns[0], patterns } : patterns[0];
                    }
                },
                { // XRDML
                    test: (name, content) => name.endsWith('.xrdml') || (content.includes('<?xml') && content.includes('<xrdMeasurement')),
                    parser: parseXrdmlFile
                },
                { // BRML
                    test: (name, content) => name.endsWith('.brml') || (content.includes('<?xml') && content.includes('<RawDataFile')),
                    parser: parseBrukerBrmlFile
                },
                { // Rigaku RASX, already unzipped by hand.
                  //
                  // This used to route to parseBrukerBrmlFile, which looks for
                  // <RawDataFile> and Bruker's TwoTheta axis attributes -- tags
                  // a RASX does not contain. RASX keeps its intensities in a
                  // plain two-column Profile text member, so an unzipped one
                  // reaching this point is either that text or an XML that only
                  // carries conditions. Both are handled by falling through.
                    test: (name, content) => name.endsWith('.rasx') && !content.includes('<?xml'),
                    parser: (content) => parseDataFile(content, fileName, { attenuation: true })
                },
                { // UXD. Fatal: the two-column fallback reads the counts block
                  // as (x, y) pairs and reported "only 1 usable point" instead
                  // of what was wrong with the UXD header.
                    test: (name, content, firstLine) => name.endsWith('.uxd') || firstLine.toUpperCase().startsWith('_FILEVERSION'),
                    fatal: () => true,
                    parser: parseUxdFile
                },
                { // Rigaku RAS
                    test: (name, content, firstLine, upper) => name.endsWith('.ras') || upper.includes('*RAS_HEADER_START'),
                    parser: parseRigakuRasFile
                },
                { // Philips UDF/RD/SD
                    test: (name) => name.endsWith('.udf') || name.endsWith('.rd') || name.endsWith('.sd'),
                    fatal: () => true,
                    parser: parsePhilipsUdfFile
                },
                { // GSAS ESD/XRA. "BANK" followed by a bank number, as the
                  // reader itself requires: a bare startsWith('BANK') made a
                  // two-column file titled "Bank of samples..." a fatal GSAS error.
                    test: (name, content, firstLine, upper, allLines) => allLines.some(line => /^BANK\s+\d+\s/i.test(line.trim())),
                    fatal: () => true,
                    parser: (content, allLines) => {
                        const bankLine = allLines.find(line => line.trim().toUpperCase().startsWith('BANK'));
                        if (bankLine.toUpperCase().includes('STD')) {
                            return parseGsasXraFile(content);
                        }
                        return parseGsasEsdFile(content);
                    }
                },
                { // Jade MDI (treat as 2-column)
                     test: (name, content, firstLine, upper) => name.endsWith('.mdi') && (upper.includes('2-THETA, INTENSITY') || upper.startsWith('(SAMPLE')),
                     parser: parseDataFile
                },
                { // Free-format constant step: "start step end", then the
                  // intensities (FullProf INSTRM=0, WinPLOTR, EXPO .dat). Before
                  // this the fallback took the first two numbers of every line
                  // as a point, so the header became (start, step) and each row
                  // of counts a point at 2-theta = its first count.
                    test: (name, content, firstLine, upper, allLines) => !!startStepEndLayout(allLines),
                    parser: (content) => parseStartStepEndFile(content)
                }
            ];
            
            //   Iterate Registry  
            for (const rule of PARSER_REGISTRY) {
                try {
                    if (rule.test(name, fileContent, firstLine, upperContent, lines)) {
                        // Pass 'content' to parser, but 'lines' to the special GSAS one
                        if (rule.parser.length > 1) {
                             return rule.parser(fileContent, lines); // For GSAS parser
                        }
                        return rule.parser(fileContent);
                    }
                } catch (e) {
                    if (rule.fatal && rule.fatal(name)) throw e;
                    console.warn(`Parser ${rule.parser.name} failed, trying next...`, e.message);
                }
            }

            //   Fallback for all other 2-column-like formats  
            // This will attempt to parse: .xy, .csv, .txt, .dat, .asc, etc.
            return parseDataFile(fileContent, fileName);
        };
    
        /**
         * Final gate every parser's output passes through before it becomes
         * fullExperimentalData.
         *
         * Two things were previously only warned about in the console and then
         * used anyway:
         *   - Non-finite points. A single NaN 2-theta poisons the axis range and
         *     every downstream binary search.
         *   - Descending 2-theta. lowerBound() is a binary search that requires
         *     an ASCENDING array, and the loader takes tth[0] / tth[n-1] as the
         *     slider min / max. A descending file therefore produced a negative
         *     slider step and silently wrong pattern slicing rather than an error.
         */
        const normalizeParsedData = (parsed, fileName = "") => {
            if (!parsed || !parsed.tth || !parsed.intensity) {
                throw new Error(`Parser returned no data for ${fileName}.`);
            }
            const n = Math.min(parsed.tth.length, parsed.intensity.length);
            if (parsed.tth.length !== parsed.intensity.length) {
                console.warn(`Data File (${fileName}) Warning: 2-theta and intensity counts differ ` +
                             `(${parsed.tth.length} vs ${parsed.intensity.length}); using the first ${n}.`);
            }

            const pts = [];
            let dropped = 0;
            for (let i = 0; i < n; i++) {
                const x = parsed.tth[i], y = parsed.intensity[i];
                // i is kept so the per-point companion columns below follow the
                // point through the drop / sort / dedup steps.
                if (isFinite(x) && isFinite(y)) pts.push({ x, y, i }); else dropped++;
            }
            if (dropped > 0) {
                console.warn(`Data File (${fileName}) Warning: discarded ${dropped} non-finite point(s).`);
            }
            if (pts.length === 0) {
                throw new Error(`No usable numeric data points were found in ${fileName}.`);
            }

            let sorted = true;
            for (let i = 1; i < pts.length; i++) {
                if (pts[i].x < pts[i - 1].x) { sorted = false; break; }
            }
            if (!sorted) {
                pts.sort((a, b) => a.x - b.x);
                console.warn(`Data File (${fileName}) Notice: 2-theta was not ascending; the data has been sorted.`);
            }

            // Collapse exact duplicate 2-theta values: they give a zero-width
            // interval that the spline interpolator cannot handle.
            const outX = [], outY = [], keep = [];
            let duplicates = 0;
            for (let i = 0; i < pts.length; i++) {
                if (i > 0 && pts[i].x === pts[i - 1].x) { duplicates++; continue; }
                outX.push(pts[i].x); outY.push(pts[i].y); keep.push(pts[i].i);
            }
            if (duplicates > 0) {
                console.warn(`Data File (${fileName}) Notice: removed ${duplicates} duplicate 2-theta point(s).`);
            }
            if (outX.length < 2) {
                throw new Error(`Only ${outX.length} usable data point(s) in ${fileName}; at least two are required.`);
            }
            // Every reader returns 2-theta. A value beyond 180 degrees means the
            // layout was misread (counts taken as angles), which used to load as
            // a pattern reaching 2-theta = 100000 instead of failing.
            if (outX[0] < -180 || outX[outX.length - 1] > 180) {
                throw new Error(`The 2-theta axis read from ${fileName} runs from ${outX[0]} to ${outX[outX.length - 1]} degrees, ` +
                                `outside -180..180: the file's layout was not recognised.`);
            }

            // COMPANION COLUMNS MOVE WITH THEIR POINTS.
            //
            // A pdCIF also hands back calc and bkg, aligned 1:1 with the raw
            // tth. Rebuilding tth/intensity and spreading calc/bkg unchanged left
            // them shifted by every dropped, re-sorted or duplicate point -- a
            // calculated curve offset from the data it was fitted to.
            const out = { ...parsed, tth: outX, intensity: outY };
            for (const col of ['calc', 'bkg', 'sig', 'weights']) {
                const src = parsed[col];
                if (!src) continue;
                if ((col === 'sig' || col === 'weights') && src.length < n) throw new Error(`Incomplete ${col} column in ${fileName}.`);
                if (src.length >= n) out[col] = keep.map(k => src[k]);
                if (col === 'sig' && !out[col].every(v => Number.isFinite(v) && v > 0)) throw new Error(`Invalid standard uncertainty in ${fileName}.`);
                if (col === 'weights' && !out[col].every(v => Number.isFinite(v) && v >= 0)) throw new Error(`Invalid weight in ${fileName}.`);
            }
            return out;
        };

        /** One number and nothing else; parseFloat would accept "2Theta" as 2. */
        const NUMERIC_FIELD = /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/;
        const isCommentLine = (trimmed) => trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//') ||
                                           trimmed.startsWith('!') || trimmed.startsWith(';');

        /**
         * Wavelengths stated in the header of a text pattern: PANalytical CSV
         * ("K-Alpha1 wavelength,1.5405980", "Ratio K-Alpha2/K-Alpha1,0.5") and
         * free titles ("... Wavelength 0.79764"). These were skipped as header
         * lines, so a synchrotron pattern loaded with the Cu default.
         * Bounded to 0.05-6 A so a slit width or a date is not taken for one.
         */
        const headerWavelengths = (headerLines) => {
            const out = {};
            const value = (m) => { const v = m ? parseFloat(m[1]) : NaN; return v >= 0.05 && v <= 6 ? v : null; };
            for (const line of headerLines) {
                if (/ratio/i.test(line)) {
                    const m = line.match(/ratio\s*K-?Alpha\s*2\s*\/\s*K-?Alpha\s*1[^0-9\n]{0,10}([0-9]*\.?[0-9]+)/i);
                    if (m && isFinite(parseFloat(m[1]))) out.ratio21 = parseFloat(m[1]);
                    continue;
                }
                const a1 = value(line.match(/K-?Alpha\s*1[^0-9\n]{0,30}?([0-9]*\.[0-9]+)/i));
                const a2 = value(line.match(/K-?Alpha\s*2[^0-9\n]{0,30}?([0-9]*\.[0-9]+)/i));
                if (a1) out.wavelength = a1;
                else if (a2) out.wavelength2 = a2;
                else if (!out.wavelength) {
                    const w = value(line.match(/wave\s*length[^0-9\n]{0,20}?([0-9]*\.[0-9]+)/i));
                    if (w) out.wavelength = w;
                }
            }
            if (!(out.wavelength > 0 && out.wavelength2 > 0 && out.ratio21 >= 0)) { delete out.wavelength2; delete out.ratio21; }
            return out;
        };

        /**
         * Decimal commas ("10,02;1234" or "10,02<TAB>1234"). The separator set
         * [\s,;] split them into "10", "02", "1234" and read the point (10, 2).
         * Decided per file, from lines with a comma between digits, no point,
         * and a separator other than a comma.
         */
        const usesDecimalComma = (lines) => {
            let comma = 0, other = 0;
            for (let i = 0; i < lines.length && comma + other < 200; i++) {
                const t = lines[i].trim();
                if (isCommentLine(t) || !/^[+\-]?\d/.test(t)) continue;
                if (/^[+\-]?\d+,\d+(?:[;\t ]+[+\-]?\d+(?:,\d+)?(?:[eE][+\-]?\d+)?)+$/.test(t) && t.indexOf('.') < 0) comma++; else other++;
            }
            return comma > 0 && comma >= other;
        };

        /**
         * Generic 2-column parser. This is the fallback for most text files.
         * Includes validation logic for 2-theta (X) and step size (dX).
         *
         * opts.attenuation: Rigaku profiles (.ras data, .rasx Profile*.txt)
         * carry the attenuator factor in the third column; the intensity is
         * counts times that factor.
         */
        const parseDataFile = (text, fileName = "", opts = {}) => {
            const lines = text.trim().split(/\r?\n/);
            const tth = [], intensity = [], sig = [], header = [];
            const hasSigma = /\.(?:fxye|xye)$/i.test(String(fileName));
            const decimalComma = usesDecimalComma(lines);
            let last_x = -Infinity;
            let suspicious_steps = 0;
            let positive_x_values = 0;
            let negative_steps = 0;
            let dataStarted = false;
            let zeroSigma = 0;

            lines.forEach(line => {
                let trimmed = line.trim();

                // Skip commented or empty lines
                if (isCommentLine(trimmed)) {
                    if (!dataStarted) header.push(trimmed);
                    return;
                }
                if (decimalComma) trimmed = trimmed.replace(/(\d),(\d)/g, '$1.$2');

                // Try to read the line as a number pair first; only fall back to
                // treating it as a header when that fails. The "E" of scientific
                // notation is a letter, so a letter alone does not make a header.
                // Whole fields only: parseFloat read "2Theta 3Counts" as (2, 3).
                const parts = trimmed.split(/[\s,;]+/).filter(Boolean);
                const x = parts.length >= 2 && NUMERIC_FIELD.test(parts[0]) ? Number(parts[0]) : NaN;
                const y = parts.length >= 2 && NUMERIC_FIELD.test(parts[1]) ? Number(parts[1]) : NaN;

                if (!isFinite(x) || !isFinite(y)) {
                    if (!dataStarted) header.push(trimmed);
                    return;
                }

                dataStarted = true; // First valid numeric pair found

                if (x > 0) positive_x_values++;

                if (last_x !== -Infinity) {
                    const dX = x - last_x;
                    if (dX < 0) {
                        negative_steps++; // Data is descending
                    } else if (dX > 0 && (dX < 0.0001 || dX > 0.2)) {
                        suspicious_steps++; // Step size is weird
                    }
                }
                last_x = x;

                tth.push(x);
                const att = opts.attenuation && parts.length >= 3 ? Number(parts[2]) : NaN;
                intensity.push(att > 0 && isFinite(att) ? y * att : y);
                if (hasSigma) {
                    const s = Number(parts[2]);
                    // sigma = 0 is how several programs write a point with no
                    // counts; that rejected the whole file. Counting statistics
                    // stand in for it (at least 1), and the load says how often.
                    if (s === 0 && parts.length >= 3) { zeroSigma++; sig.push(Math.sqrt(Math.max(Math.abs(y), 1))); return; }
                    if (!(Number.isFinite(s) && s > 0)) throw new Error(`Invalid standard uncertainty at 2-theta ${x} in ${fileName}.`);
                    sig.push(s);
                }
            });

            //   Final checks (log warnings to console)
            if (tth.length > 10) {
                if (positive_x_values / tth.length < 0.5) {
                    console.warn(`Data File (${fileName}) Warning: Most 2-theta (X) values are zero or negative. This is unusual for XRD data.`);
                }
                if (negative_steps / tth.length > 0.8) {
                     console.warn(`Data File (${fileName}) Warning: Data appears to be sorted in descending 2-theta order.`);
                }
                if (suspicious_steps / tth.length > 0.2) {
                    console.warn(`Data File (${fileName}) Warning: Many data points have a step size outside the typical range (0.0001° - 0.2°). Check file format.`);
                }
            } else if (tth.length === 0) {
                 throw new Error(`Could not parse any 2-column data from ${fileName}. File may be binary or have an unknown header.`);
            }

            const warnings = zeroSigma ? [`${zeroSigma} point(s) with a standard uncertainty of 0; sqrt(max(I, 1)) used for them.`] : [];
            return { tth, intensity, sig: hasSigma ? sig : null, warnings, ...headerWavelengths(header) };
        };

        /**
         * Layout of a free-format constant-step file, or null: the first line
         * that is not a comment starts with three numbers (start, step, end;
         * text may follow), and everything after it is numbers only, as many
         * as (end - start) / step + 1 (within 1 %, for a rounded step or an end
         * stated to fewer digits). The count is what tells it from a
         * three-column x y sigma file whose first row also has three numbers.
         */
        const startStepEndLayout = (lines) => {
            let i = 0;
            while (i < lines.length && isCommentLine(lines[i].trim())) i++;
            if (i >= lines.length) return null;
            const head = lines[i].trim().split(/[\s,;]+/);
            if (head.length < 3 || !head.slice(0, 3).every(f => NUMERIC_FIELD.test(f))) return null;
            const [start, step, end] = head.slice(0, 3).map(Number);
            if (!(step > 0) || !(end > start) || start < -180 || end > 180) return null;
            const exact = (end - start) / step + 1, count = Math.round(exact);
            if (count < 3) return null;
            const values = [];
            for (let j = i + 1; j < lines.length; j++) {
                const t = lines[j].trim();
                if (isCommentLine(t)) continue;
                for (const f of t.split(/[\s,;]+/)) {
                    if (!f) continue;
                    if (!NUMERIC_FIELD.test(f)) return null;
                    values.push(Number(f));
                }
            }
            if (Math.abs(values.length - exact) > Math.max(2, Math.ceil(0.01 * count))) return null;
            return { start, step, end, count, values };
        };

        const parseStartStepEndFile = (text) => {
            const layout = startStepEndLayout(text.trim().split(/\r?\n/));
            if (!layout) throw new Error('Not a "start step end" file.');
            const { start, step, end, count } = layout, warnings = [];
            let intensity = layout.values;
            if (intensity.length > count) {
                warnings.push(`The header (${start} to ${end}, step ${step}) gives ${count} points, the file holds ${intensity.length} values; the last ${intensity.length - count} were ignored.`);
                intensity = intensity.slice(0, count);
            } else if (intensity.length < count) {
                warnings.push(`The header (${start} to ${end}, step ${step}) gives ${count} points, the file holds ${intensity.length}; read those, with the stated step.`);
            }
            return { tth: intensity.map((_, i) => start + i * step), intensity, warnings };
        };

        /** One pattern, or the first with all of them in .patterns (what readData expects of a multi-scan file). */
        const onePattern = (patterns) => patterns.length > 1 ? { ...patterns[0], patterns } : patterns[0];

        // XRDML. One pattern per <dataPoints>: a file with several scans used to
        // give the first scan's intensities only. 2-theta from start/endPosition,
        // or from <listPositions> where the file lists every position (that
        // layout was refused). Ka2 and its ratio are read with Ka1.
        const parseXrdmlFile = (xmlString) => {
            const xmlDoc = new DOMParser().parseFromString(xmlString, "application/xml");
            if (xmlDoc.querySelector("parsererror")) throw new Error("Error parsing XRDML file.");
            const num = (el, sel) => { const n = el.querySelector(sel); return n ? parseFloat(n.textContent) : NaN; };
            const used = xmlDoc.querySelector("usedWavelength") || xmlDoc;
            const wavelength = num(used, "kAlpha1"), wavelength2 = num(used, "kAlpha2"), ratio21 = num(used, "ratioKAlpha2KAlpha1");
            const lambda = { wavelength: wavelength > 0 ? wavelength : null };
            if (wavelength > 0 && wavelength2 > 0 && ratio21 >= 0) { lambda.wavelength2 = wavelength2; lambda.ratio21 = ratio21; }
            const blocks = Array.from(xmlDoc.querySelectorAll("dataPoints"));
            if (!blocks.length) throw new Error("Could not find <dataPoints> in XRDML file.");
            return onePattern(blocks.map((dp, k) => {
                const intensityNode = dp.querySelector("intensities") || dp.querySelector("counts");
                if (!intensityNode) throw new Error("Could not find <intensities> or <counts> in XRDML file.");
                const intensity = intensityNode.textContent.trim().split(/\s+/).map(Number);
                if (intensity.length < 2) throw new Error("XRDML file contains fewer than two data points.");
                const positionsNode = dp.querySelector('positions[axis="2Theta"]');
                if (!positionsNode) throw new Error("Could not find <positions> in XRDML file.");
                const list = positionsNode.querySelector("listPositions");
                let tth;
                if (list) {
                    tth = list.textContent.trim().split(/\s+/).map(Number);
                    if (tth.length !== intensity.length) throw new Error(`XRDML <listPositions> holds ${tth.length} positions for ${intensity.length} intensities.`);
                } else {
                    const startPos = num(positionsNode, "startPosition"), endPos = num(positionsNode, "endPosition");
                    if (!isFinite(startPos) || !isFinite(endPos)) throw new Error("XRDML start/end positions are missing or not numeric.");
                    const step = (endPos - startPos) / (intensity.length - 1);
                    tth = Array.from({ length: intensity.length }, (_, i) => startPos + i * step);
                }
                return { tth, intensity, ...lambda, blockName: 'scan ' + (k + 1) };
            }));
        };

        // Bruker BRML RawData. DIFFRAC.SUITE writes each scan as a <DataRoute>
        // of <Datum> records (comma separated, counts last) with the axis in
        // <ScaleAxisInfo AxisId="TwoTheta"> (Start, Increment), and the
        // wavelengths as <WaveLengthAlpha1 Value="..."/>. Only a <dataPoints>/
        // <counts> layout was read before. Without the axis block, 2-theta is
        // the third field of each record.
        const parseBrukerBrmlFile = (xmlString) => {
            const xmlDoc = new DOMParser().parseFromString(xmlString, "application/xml");
            if (xmlDoc.querySelector("parsererror")) throw new Error("Error parsing BRML file.");
            const num = (el, sel) => { const n = el.querySelector(sel); return n ? parseFloat(n.textContent) : NaN; };
            const valueOf = (sel) => { const n = xmlDoc.querySelector(sel); return n ? parseFloat(n.getAttribute('Value')) : NaN; };
            let wavelength = null;
            const wlNode = xmlDoc.querySelector('usedWavelength');
            if (wlNode && parseFloat(wlNode.getAttribute('kAlpha1')) > 0) wavelength = parseFloat(wlNode.getAttribute('kAlpha1'));
            const a1 = valueOf('WaveLengthAlpha1'), a2 = valueOf('WaveLengthAlpha2'), ratio21 = valueOf('WaveLengthRatio');
            if (!wavelength && a1 > 0) wavelength = a1;
            const lambda = { wavelength };
            if (wavelength > 0 && a2 > 0 && ratio21 >= 0) { lambda.wavelength2 = a2; lambda.ratio21 = ratio21; }
            const intensityNode = xmlDoc.querySelector("dataPoints > counts");
            if (intensityNode) {
                const intensity = intensityNode.textContent.trim().split(/\s+/).map(Number);
                const startPos = num(xmlDoc, 'startPosition[axis="TwoTheta"]'), stepSize = num(xmlDoc, 'increment[axis="TwoTheta"]');
                // Same guard, and same wording, as XRDML, UXD and both GSAS readers.
                if (!isFinite(startPos) || !isFinite(stepSize) || stepSize === 0) throw new Error("BRML scan parameters are not numeric (startPosition / increment).");
                return { tth: Array.from({ length: intensity.length }, (_, i) => startPos + i * stepSize), intensity, ...lambda };
            }
            const routes = Array.from(xmlDoc.querySelectorAll('DataRoute')).filter(r => r.querySelector('Datum'));
            if (!routes.length) throw new Error("No scan data (<Datum> records or <counts>) found in BRML file.");
            return onePattern(routes.map((route, k) => {
                const rows = Array.from(route.querySelectorAll('Datum')).map(d => d.textContent.split(',').map(Number));
                const axis = route.querySelector('ScaleAxisInfo[AxisId="TwoTheta"]');
                const start = axis ? num(axis, 'Start') : NaN, inc = axis ? num(axis, 'Increment') : NaN;
                const intensity = rows.map(r => r[r.length - 1]);
                const tth = isFinite(start) && isFinite(inc) && inc !== 0 ? rows.map((_, i) => start + i * inc)
                                                                         : rows.map(r => r.length >= 4 ? r[2] : NaN);
                return { tth, intensity, ...lambda, blockName: 'scan ' + (k + 1) };
            }));
        };

        // Rigaku RAS: a header of *KEY "value" lines and a *RAS_INT_START ...
        // *RAS_INT_END block per scan, rows of "2-theta counts attenuator".
        // The wavelength is *HW_XG_WAVE_LENGTH_ALPHA1, quoted; the old reader
        // looked for other keys and parsed the quote, so it never had one. The
        // intensity is counts times the attenuator factor, and every block is
        // read (reading stopped at the first).
        const parseRigakuRasFile = (text) => {
            const scans = [];
            let wavelength = null, cur = null;
            for (const raw of text.split(/\r?\n/)) {
                const line = raw.trim();
                if (line.startsWith('*')) {
                    const m = line.match(/^\*(\S+)\s*(.*)$/);
                    if (!m) continue;
                    const key = m[1].toUpperCase(), value = parseFloat(m[2].replace(/"/g, ''));
                    if (/^(HW_XG_WAVE_LENGTH_ALPHA1|MEAS_COND_XG_WAVE_LENGTH|WAVE_LENGTH)$/.test(key) && value > 0) wavelength = value;
                    else if (key === 'RAS_INT_START') { cur = { tth: [], intensity: [], wavelength }; scans.push(cur); }
                    else if (key === 'RAS_INT_END') cur = null;
                    continue;
                }
                if (!cur) continue;
                const parts = line.split(/[\s,]+/);
                if (parts.length < 2 || !NUMERIC_FIELD.test(parts[0]) || !NUMERIC_FIELD.test(parts[1])) continue;
                const att = parts.length >= 3 ? Number(parts[2]) : NaN;
                cur.tth.push(Number(parts[0]));
                cur.intensity.push(Number(parts[1]) * (att > 0 && isFinite(att) ? att : 1));
            }
            const read = scans.filter(s => s.tth.length);
            if (!read.length) throw new Error("No data found in RAS file data section.");
            read.forEach((s, k) => { s.blockName = 'scan ' + (k + 1); });
            return onePattern(read);
        };

        // GSAS constant-step scans. Read one bank and honour its channel count;
        // padding in the last fixed-width record is not measured data.
        const parseGsasBankFile = (text, defaultType) => {
            const lines = text.trim().split(/\r?\n/);
            let wavelength = null;
            for (const line of lines) {
                const match = line.match(/wavelength\s+([0-9.eE+\-]+)/i);
                if (match && isFinite(parseFloat(match[1]))) wavelength = parseFloat(match[1]);
            }
            const bankIndex = lines.findIndex(line => /^BANK\b/i.test(line.trim()));
            if (bankIndex < 0) throw new Error('GSAS Parse Error: No BANK header found.');
            const header = lines[bankIndex].trim().split(/\s+/);
            const count = Number(header[2]);
            const start = Number(header[5]) / 100;
            const step = Number(header[6]) / 100;
            const type = (header[9] || defaultType).toUpperCase();
            if (!['CONST', 'CONS'].includes((header[4] || '').toUpperCase()) ||
                !Number.isInteger(count) || count < 1 ||
                !Number.isFinite(start) || !Number.isFinite(step) || step === 0 ||
                !['STD', 'ESD', 'FXYE'].includes(type)) {
                throw new Error('GSAS Parse Error: Invalid or unsupported BANK scan parameters.');
            }
            const intensity = [], tth = [], sig = [];
            const numeric = /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/;
            for (let i = bankIndex + 1; i < lines.length && intensity.length < count; i++) {
                const line = lines[i];
                if (/^BANK\b/i.test(line.trim())) break;
                if (!line.trim() || /^[#!;]/.test(line.trim())) continue;
                let fields = line.trim().split(/\s+/);
                // STD uses 10I8 and ESD uses 10F8. Adjacent full-width values
                // need slicing; whitespace alone would merge them into one.
                // STD is 10(I2,F6.0): each 8-character field holds a counter
                // count (often blank) and then the intensity. A filled counter
                // ("  1   179") failed the whole-field test, and the whitespace
                // split then read the 1 as an intensity of its own. Lines whose
                // trailing blanks an editor removed are padded back to fields.
                if (type !== 'FXYE') {
                    const body = line.replace(/\s+$/, '');
                    const fixed = (body.padEnd(Math.ceil(body.length / 8) * 8).match(/.{8}/g) || []).map(v => {
                        const t = v.trim();
                        if (!t || numeric.test(t)) return t;
                        if (type === 'STD' && /^[ \d]{2}$/.test(v.slice(0, 2)) && numeric.test(v.slice(2).trim())) return v.slice(2).trim();
                        return null;
                    });
                    if (fixed.length && fixed.every(v => v !== null)) fields = fixed;
                }
                if (type === 'FXYE') {
                    const x = Number(fields[0]), y = Number(fields[1]), s = Number(fields[2]);
                    if (fields.length < 3 || !Number.isFinite(x) || !Number.isFinite(y) || !(s > 0 && Number.isFinite(s))) {
                        throw new Error('GSAS Parse Error: Invalid FXYE data record.');
                    }
                    tth.push(x / 100); intensity.push(y); sig.push(s);
                } else {
                    const stride = type === 'ESD' ? 2 : 1;
                    for (let j = 0; j < fields.length && intensity.length < count; j += stride) {
                        if (!fields[j]) continue;
                        if (!numeric.test(fields[j]) ||
                            (stride === 2 && !numeric.test(fields[j + 1] || ''))) {
                            throw new Error('GSAS Parse Error: Invalid intensity data record.');
                        }
                        const y = Number(fields[j]);
                        if (!Number.isFinite(y)) throw new Error('GSAS Parse Error: Non-finite intensity.');
                        intensity.push(y);
                        if (stride === 2) {
                            const s = Number(fields[j + 1]);
                            if (!(s > 0 && Number.isFinite(s))) throw new Error('GSAS Parse Error: Invalid standard uncertainty.');
                            sig.push(s);
                        }
                    }
                }
            }
            if (intensity.length < 2) {
                throw new Error(`GSAS Parse Error: BANK declares ${count} channels, but only ${intensity.length} were read; at least two complete points are required.`);
            }
            // Retain measured records when the header count exceeds the data.
            // Never pad missing intensities or uncertainties to the declared size.
            const warnings = intensity.length !== count ?
                [`GSAS BANK declares ${count} channels, but ${intensity.length} complete points were read. Imported only those points, without padding. Check whether the file is incomplete or its header count is incorrect.`] : [];
            return {
                tth: type === 'FXYE' ? tth : Array.from({ length: intensity.length }, (_, i) => start + i * step),
                intensity, wavelength, sig: type === 'STD' ? null : sig, warnings
            };
        };
        const parseGsasEsdFile = (text) => parseGsasBankFile(text, 'ESD');
        const parseGsasXraFile = (text) => parseGsasBankFile(text, 'STD');

        // Bruker UXD: "_KEY=value" lines (spaces around "=" allowed; "_START = 10"
        // was not recognised), then a data block per range: _COUNTS or _CPS
        // (intensities, 2-theta from that range's _START and _STEPSIZE) or
        // _2THETACOUNTS / _2THETACPS (pairs, which were refused). Each range is
        // its own pattern; they used to be appended to the first range's axis.
        // Counts per second become counts with _STEPTIME, so the weights follow
        // counting statistics.
        const parseUxdFile = (text) => {
            const cfg = {}, ranges = [];
            let cur = null;
            for (const raw of text.split(/\r?\n/)) {
                const line = raw.trim();
                if (!line || line.startsWith(';')) continue;
                const m = line.match(/^_([A-Z0-9_\-]+)\s*(?:=\s*(.*))?$/i);
                if (m) {
                    const key = m[1].toUpperCase();
                    cur = null;
                    if (/^(2THETA)?(COUNTS|CPS)$/.test(key)) {
                        const time = key.endsWith('CPS') && cfg.STEPTIME > 0 ? cfg.STEPTIME : 1;
                        cur = { pairs: key.startsWith('2THETA'), start: cfg.START, step: cfg.STEPSIZE, time, tth: [], intensity: [] };
                        ranges.push(cur);
                    } else if (m[2] !== undefined) cfg[key] = parseFloat(m[2].replace(/^["']/, ''));
                    continue;
                }
                if (!cur) continue;
                const fields = line.split(/[\s,]+/).filter(Boolean);
                if (!fields.every(f => NUMERIC_FIELD.test(f))) throw new Error(`UXD data line is not numeric: "${line.slice(0, 40)}".`);
                if (!cur.pairs) fields.forEach(f => cur.intensity.push(Number(f) * cur.time));
                else if (fields.length >= 2) { cur.tth.push(Number(fields[0])); cur.intensity.push(Number(fields[1]) * cur.time); }
            }
            const lambda = { wavelength: cfg.WL1 > 0 ? cfg.WL1 : null };
            if (cfg.WL1 > 0 && cfg.WL2 > 0 && cfg.WLRATIO >= 0) { lambda.wavelength2 = cfg.WL2; lambda.ratio21 = cfg.WLRATIO; }
            const patterns = ranges.filter(r => r.intensity.length).map((r, k) => {
                if (!r.pairs) {
                    if (!isFinite(r.start) || !isFinite(r.step) || r.step === 0) throw new Error("Could not find valid _START and _STEPSIZE in UXD file.");
                    r.tth = r.intensity.map((_, i) => r.start + i * r.step);
                }
                return { tth: r.tth, intensity: r.intensity, ...lambda, blockName: 'range ' + (k + 1) };
            });
            if (!patterns.length) throw new Error("No intensity data found after _COUNTS (or _CPS, _2THETACOUNTS) in UXD file.");
            return onePattern(patterns);
        };

        const parsePhilipsRawScan = (text) => {
            const lines = text.split(/\r?\n/), header = {};
            const first = lines.findIndex(line => /^RawScan\s*$/i.test(line.trim()));
            for (const line of lines.slice(0, first)) {
                const fields = line.split(',').map(v => v.trim());
                header[fields[0].toLowerCase()] = fields.slice(1).filter(v => v && v !== '/');
            }
            const number = key => Number((header[key] || [])[0]);
            const range = header.dataanglerange || [], start = Number(range[0]), end = Number(range[1]), step = number('scanstepsize');
            if (!Number.isFinite(start) || !Number.isFinite(step) || step === 0) throw new Error('UDF RawScan requires a numeric DataAngleRange start and nonzero ScanStepSize.');
            const intensity = [], numeric = /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/;
            let finished = false;
            for (const line of lines.slice(first + 1)) {
                const slash = line.indexOf('/'), record = slash < 0 ? line : line.slice(0, slash);
                for (const field of record.trim().split(/[\s,]+/).filter(Boolean)) {
                    if (!numeric.test(field) || !Number.isFinite(Number(field))) throw new Error('UDF RawScan contains an invalid intensity: ' + field);
                    intensity.push(Number(field));
                }
                if (slash >= 0) { finished = true; break; }
            }
            if (intensity.length < 2) throw new Error('UDF RawScan contains fewer than two intensity points.');
            const tth = intensity.map((_, i) => start + i * step), warnings = [];
            if (Number.isFinite(end) && Math.abs(tth[tth.length - 1] - end) > Math.max(Math.abs(step) / 2, 1e-5)) {
                warnings.push('UDF DataAngleRange ends at ' + end + ' degrees, but ' + intensity.length + ' intensities with ScanStepSize ' + step + ' end at ' + tth[tth.length - 1].toFixed(7) + ' degrees. Kept all measured points with the stated step; check the header range.');
            }
            if (!finished) warnings.push('UDF RawScan has no closing / marker; loaded the available complete numeric points. Check whether the file is incomplete.');
            const wavelength = number('labdaalpha1'), wavelength2 = number('labdaalpha2'), ratio21 = number('ratioalpha21');
            return { tth, intensity, wavelength: wavelength > 0 ? wavelength : null,
                     wavelength2: wavelength2 > 0 ? wavelength2 : null, ratio21: Number.isFinite(ratio21) && ratio21 >= 0 ? ratio21 : null, warnings };
        };
        const parsePhilipsUdfFile = (text) => { if (/^\s*RawScan\s*$/im.test(text)) return parsePhilipsRawScan(text); const lines = text.trim().split(/\r?\n/); const tth = [], intensity = []; let inDataSection = false; let wavelength = null; for (const line of lines) { const trimmedLine = line.trim(); if (trimmedLine.toUpperCase().startsWith('LAMBDA')) { const parts = trimmedLine.split('='); if (parts.length > 1) wavelength = parseFloat(parts[1]); } if (trimmedLine.toUpperCase() === '[DATA]') { inDataSection = true; continue; } if (trimmedLine.startsWith('[') && trimmedLine.toUpperCase() !== '[DATA]') inDataSection = false; if (inDataSection) { const parts = trimmedLine.split(/,/).map(p => p.trim()); if(parts.length >= 2) { const x = parseFloat(parts[0]); const y = parseFloat(parts[1]); if (!isNaN(x) && !isNaN(y)) { tth.push(x); intensity.push(y); } } } } if (tth.length === 0) throw new Error("No [Data] section found in UDF file."); return { tth, intensity, wavelength }; };
