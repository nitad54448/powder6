        // ===================================================================
        // Space-Group modal: filter chips + search + explanation panel.
        // All settings (≈530 rows) are pre-materialised into a flat
        // array `ALL_SETTINGS` once; every re-filter walks that array.
        // With an AND'd filter chain this is cheap (< 2 ms on any machine).
        // ===================================================================
        const SGM = (() => {
            //   Build the pooled list once.  
            //  Listed high → low symmetry so the most-used systems appear first.
            const SYSTEMS = ['cubic','hexagonal','trigonal','tetragonal','orthorhombic','monoclinic','triclinic'];
            const CENTERINGS = ['P','A','B','C','I','F','R'];

 
            function buildAllSettings() {
                const out = [];
                for (let n = 1; n <= 230; n++) {
                    const entries = SG_ENGINE.listSettings(n);
                    entries.forEach(rec => {
                        // rec already has: number, symbol, standard_symbol,
                        // setting_description, hall, system, laue_class,
                        // point_group, centering, centrosymmetric,
                        // reflection_conditions, display_label (optional),
                        // alternate_halls (optional).
                        //
                        // The HKL generator only supports hexagonal-axes
                        // indexing for R-centred groups (the d-spacing
                        // formula and asymmetric-unit loop are written
                        // that way). Drop the rhomb-axes duplicates so
                        // the user can't pick a setting the engine
                        // wouldn't handle correctly.
                        const lbl = rec.display_label || '';
                        if (/rhomb\. axes/.test(lbl)) return;

                        // Strip the now-redundant "[hex. axes]" tag from
                        // the remaining label, so an R-centred entry
                        // just reads e.g. "R-3c" like every other group.
                        if (/hex\. axes/.test(lbl)) {
                            rec = { ...rec,
                                    display_label: lbl.replace(/\s*\[hex\. axes\]\s*/, '').trim() };
                        }
                        out.push(rec);
                    });
                }
                return out;
            }

            let ALL_SETTINGS = null;

            //   Modal DOM handles (resolved lazily).

            let nodes = null;
            function grabNodes() {
                if (nodes) return nodes;
                nodes = {
                    overlay: document.getElementById('sg-modal-overlay'),
                    systemRow: document.getElementById('sg-chip-row-system'),
                    centRow:   document.getElementById('sg-chip-row-centering'),
                    axesLabel: document.getElementById('sg-chip-row-axes-label'),
                    axesRow:   document.getElementById('sg-chip-row-axes'),
                    numInput:  document.getElementById('sg-search-number'),
                    txtInput:  document.getElementById('sg-search-text'),
                    listWrap:  document.getElementById('sg-list-wrap'),
                    explain:   document.getElementById('sg-explain'),
                    btnCancel: document.getElementById('sg-btn-cancel'),
                    btnReset:  document.getElementById('sg-btn-reset'),
                    btnApply:  document.getElementById('sg-btn-apply')
                };
                return nodes;
            }

            //   Filter state. Reset() brings everything back to this.  
            const state = {
                system: null,       // one of SYSTEMS or null
                centering: null,    // one of CENTERINGS or null
                axis: null,         // 'hex' | 'rhomb' | null
                numText: '',
                txtText: '',
                selected: null      // the chosen setting record, or null
            };

            function resetState() {
                state.system = null;
                state.centering = null;
                state.axis = null;
                state.numText = '';
                state.txtText = '';
                state.selected = null;
            }

            function mkChip(label, active, disabled, onClick) {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'sg-chip' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
                chip.textContent = label;
                chip.disabled = !!disabled;
                if (!disabled) chip.addEventListener('click', onClick);
                return chip;
            }

            // Which centerings are possible, given the current filter set
            // (excluding `centering` itself — we derive its enabled options
            // from what the OTHER filters allow). Same idea for axes.
            function availableCenteringsGiven(exclSystem) {
                const out = new Set();
                ALL_SETTINGS.forEach(rec => {
                    if (exclSystem && rec.system !== exclSystem) return;
                    out.add(rec.centering);
                });
                return out;
            }
            function axisChoiceApplies() {
                // Show the axis row only when the selection could be an
                // R-centred trigonal group (that's the only case where we
                // surface both hex- and rhomb-axis indexings).
                // Criterion: any row with an axis tag survives the current
                // non-axis filters.
                return ALL_SETTINGS.some(rec => {
                    if (!rec.axis) return false;
                    if (state.system && rec.system !== state.system) return false;
                    if (state.centering && rec.centering !== state.centering) return false;
                    return true;
                });
            }

            function renderChips() {
                const n = grabNodes();

                // System chips. Every system is always enabled because
                // toggling one simply reshapes the rest of the UI.
                n.systemRow.innerHTML = '';
                SYSTEMS.forEach(sys => {
                    n.systemRow.appendChild(mkChip(
                        sys.charAt(0).toUpperCase() + sys.slice(1),
                        state.system === sys,
                        false,
                        () => {
                            state.system = state.system === sys ? null : sys;
                            // Clear centering/axis if they no longer fit.
                            const avail = availableCenteringsGiven(state.system);
                            if (state.centering && !avail.has(state.centering)) state.centering = null;
                            if (!axisChoiceApplies()) state.axis = null;
                            renderAll();
                        }
                    ));
                });

                // Centering chips. Enabled set depends on current system.
                n.centRow.innerHTML = '';
                const avail = availableCenteringsGiven(state.system);
                CENTERINGS.forEach(c => {
                    const enabled = avail.has(c);
                    n.centRow.appendChild(mkChip(
                        c,
                        state.centering === c,
                        !enabled,
                        () => {
                            state.centering = state.centering === c ? null : c;
                            if (!axisChoiceApplies()) state.axis = null;
                            renderAll();
                        }
                    ));
                });

                // Axis-choice chips (shown only when relevant).
                const axisShown = axisChoiceApplies();
                n.axesLabel.style.display = axisShown ? '' : 'none';
                n.axesRow.style.display   = axisShown ? '' : 'none';
                n.axesRow.innerHTML = '';
                if (axisShown) {
                    [['hex','Hex. axes'],['rhomb','Rhomb. axes']].forEach(([key, label]) => {
                        n.axesRow.appendChild(mkChip(
                            label,
                            state.axis === key,
                            false,
                            () => {
                                state.axis = state.axis === key ? null : key;
                                renderAll();
                            }
                        ));
                    });
                }
            }

            function applyFilters() {
                const numQ = (state.numText || '').trim();
                const txtQ = (state.txtText || '').trim().toLowerCase();
                return ALL_SETTINGS.filter(rec => {
                    if (state.system    && rec.system     !== state.system)    return false;
                    if (state.centering && rec.centering  !== state.centering) return false;
                    if (state.axis) {
                        if (rec.axis !== state.axis) return false;
                    }
                    if (numQ) {
                        // Exact integer match, or prefix match on the number.
                        if (/^\d+$/.test(numQ)) {
                            if (String(rec.number) !== numQ) return false;
                        } else {
                            return false;
                        }
                    }
                    if (txtQ) {
                        const hay = (
                            rec.symbol + ' ' +
                            rec.standard_symbol + ' ' +
                            (rec.hall || '') + ' ' +
                            (rec.display_label || '')
                        ).toLowerCase();
                        if (hay.indexOf(txtQ) === -1) return false;
                    }
                    return true;
                });
            }

            function renderList(list) {
                const n = grabNodes();
                if (list.length === 0) {
                    n.listWrap.innerHTML = '<div class="sg-list-empty">No space groups match these filters.</div>';
                    return;
                }
                // Make sure the selection (if any) is still in the filtered list;
                // if not, drop it.


if (state.selected) {
    const keep = list.some(r =>
        r.number === state.selected.number
        && r.hall === state.selected.hall
    );
    if (!keep) state.selected = null;
}


                const frag = document.createDocumentFragment();
                list.slice(0, 600).forEach(rec => {   // cap — 530 max anyway
                    const row = document.createElement('div');
                    row.className = 'sg-list-item';
                    
                    const isSel = state.selected
    && rec.number === state.selected.number
    && rec.hall === state.selected.hall;

                    if (isSel) row.classList.add('selected');
                    row.innerHTML =
                        `<span class="num">#${rec.number}</span>`
                        + `<span>${escapeHtml(rec.display_label || rec.symbol)}</span>`
                        + `<span class="sys">${rec.system}</span>`;
                    row.addEventListener('click', () => {
                        state.selected = rec;
                        renderAll();
                    });
                    frag.appendChild(row);
                });
                n.listWrap.innerHTML = '';
                n.listWrap.appendChild(frag);
            }

            function escapeHtml(s) {
                return String(s)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }

            function renderExplain(list) {
                const n = grabNodes();
                // Precedence:
                //   1. Empty list  -> "No match" message in the panel.
                //   2. Has list, nothing selected -> hint.
                //   3. Has selection -> full details.
                if (list.length === 0) {
                    n.explain.innerHTML =
                        '<div class="sg-explain-warning">'
                        + '<strong>No space groups match these filters.</strong><br>'
                        + 'Adjust the selections or clear a search field. '
                        + 'Apply stays disabled until a row is selected.'
                        + '</div>';
                    return;
                }
                if (!state.selected) {
                    n.explain.innerHTML =
                        '<div class="sg-explain-empty">'
                        + `<strong>${list.length}</strong> space-group setting`
                        + (list.length === 1 ? '' : 's')
                        + ' match the current filters. Pick one from the list to see details.'
                        + '</div>';
                    return;
                }
                const rec = state.selected;
                const condHtml = renderConditions(rec.reflection_conditions);
                n.explain.innerHTML =
                    '<div class="sg-explain">'
                    + `<h3>${escapeHtml(rec.display_label || rec.symbol)}</h3>`
                    + '<dl class="sg-explain-grid">'
                    + row('Number',    '#' + rec.number)
                    + row('Symbol',    rec.symbol)
                    + row('Setting',   rec.setting_description || '(default)')
                    + row('System',    rec.system)
                    + row('Laue class', rec.laue_class)
                    + row('Point group', rec.point_group)
                    + row('Centering', rec.centering)
                    + row('Hall',      rec.hall || '—')
                    + row('Centrosymmetric', rec.centrosymmetric ? 'yes' : 'no')
                    + '</dl>'
                    + '<div style="margin-top:12px;">'
                    +   '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--system-secondary-label);margin-bottom:4px;">Reflection conditions</div>'
                    +   condHtml
                    + '</div>'
                    + '</div>';
                function row(k, v) {
                    return `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`;
                }
            }

            function renderConditions(conds) {
                const keys = conds ? Object.keys(conds) : [];
                if (keys.length === 0) {
                    return '<div style="font-size:12px;color:var(--system-secondary-label);">No reflection conditions (every hkl is allowed).</div>';
                }
                let html = '<table class="sg-explain-cond-table"><thead><tr><th>Family</th><th>Rule</th></tr></thead><tbody>';
                keys.forEach(fam => {
                    (conds[fam] || []).forEach(rule => {
                        html += `<tr><td>${escapeHtml(fam)}</td><td>${escapeHtml(rule)}</td></tr>`;
                    });
                });
                html += '</tbody></table>';
                return html;
            }

            function renderAll() {
                renderChips();
                const list = applyFilters();
                renderList(list);
                renderExplain(list);
                const n = grabNodes();
                n.btnApply.disabled = !state.selected;
            }

           //   Public API  
            let lastFocusedElement = null;
            function open(prefill) {
                if (!ALL_SETTINGS) ALL_SETTINGS = buildAllSettings();
                const n = grabNodes();
                lastFocusedElement = document.activeElement;
                // Either preload from the current SG or start blank.

if (prefill) {
    state.system = null;
    state.centering = null;
    state.axis = null;
    state.numText = '';
    state.txtText = '';



  state.selected = ALL_SETTINGS.find(r =>
    r.number === prefill.number
    && r.hall === prefill.hall
) || null;


} else {
    resetState();
}


                n.numInput.value = state.numText;
                n.txtInput.value = state.txtText;

                
                renderAll();
n.overlay.classList.add('open');
n.overlay.setAttribute('aria-hidden', 'false');
setTimeout(() => {
    n.txtInput.focus();
    // Scroll the list to the selected item
    if (state.selected) {
        const selectedRow = n.listWrap.querySelector('.sg-list-item.selected');
        if (selectedRow) {
            selectedRow.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
    }
}, 40);


            }
            function close() {
                const n = grabNodes();
                n.overlay.classList.remove('open');
                n.overlay.setAttribute('aria-hidden', 'true');
                if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                    lastFocusedElement.focus();
                    lastFocusedElement = null;
                }
            }

            //   Event wiring (idempotent).  
            function wire(onApply) {
                const n = grabNodes();
                n.numInput.addEventListener('input', (e) => {
                    state.numText = e.target.value;
                    renderAll();
                });
                n.txtInput.addEventListener('input', (e) => {
                    state.txtText = e.target.value;
                    renderAll();
                });
                n.btnCancel.addEventListener('click', close);
                n.btnReset.addEventListener('click', () => {
                    resetState();
                    n.numInput.value = '';
                    n.txtInput.value = '';
                    renderAll();
                });
                n.btnApply.addEventListener('click', () => {
                    if (!state.selected) return;
                    onApply(state.selected);
                    close();
                });
                // Close on Escape; backdrop click; trap Tab focus inside modal.
                n.overlay.addEventListener('click', (e) => {
                    if (e.target === n.overlay) close();
                });
                document.addEventListener('keydown', (e) => {
                    if (!n.overlay.classList.contains('open')) return;
                    if (e.key === 'Escape') {
                        close();
                    } else if (e.key === 'Tab') {
                        const focusable = Array.from(n.overlay.querySelectorAll(
                            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
                        )).filter(el => el.offsetParent !== null);
                        if (!focusable.length) return;
                        const first = focusable[0], last = focusable[focusable.length - 1];
                        if (e.shiftKey && (document.activeElement === first || !n.overlay.contains(document.activeElement))) {
                            e.preventDefault();
                            last.focus();
                        } else if (!e.shiftKey && (document.activeElement === last || !n.overlay.contains(document.activeElement))) {
                            e.preventDefault();
                            first.focus();
                        }
                    }
                });
            }

            return { open, close, wire };
        })();


