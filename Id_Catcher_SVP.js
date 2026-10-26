javascript:(async () => {

    // Helpers sécurité
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s); }
    function stripAccents(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // Popup unique avec délégation pour les boutons de copie
    function createPopup(html) {
        let prev = document.getElementById('hal-idcatcher-popup');
        if (prev) prev.remove();
        let d = document.createElement('div');
        d.id = 'hal-idcatcher-popup';
        d.style.cssText = 'position:fixed;top:20px;right:20px;background:white;border:2px solid #444;padding:10px;z-index:99999;max-height:70%;overflow-y:auto;width:520px;font-family:sans-serif;';
        d.innerHTML = html;
        let b = document.createElement('button');
        b.textContent = 'Fermer';
        b.style.marginTop = '10px';
        b.onclick = () => d.remove();
        d.appendChild(b);
        d.addEventListener('click', (ev) => {
            const btn = ev.target.closest('button[data-copy]');
            if (!btn) return;
            const t = btn.getAttribute('data-copy');
            navigator.clipboard?.writeText(t).then(() => {
                const old = btn.textContent;
                btn.textContent = '✓';
                setTimeout(() => btn.textContent = old, 1000);
            });
        });
        document.body.appendChild(d);
    }

    try {
        let prenom = '', nom = '';
        const host = window.location.hostname;
        const isSovisu = host.includes('sovisuplus');

        if (isSovisu) {
            // === SoVisu+ : nom extrait de l'URL (?perspective=person:prenom-nom) ===
            const perspective = new URLSearchParams(window.location.search).get('perspective') || '';
            const slug = perspective.replace(/^person:/i, '');
            const parts = slug.split('-').filter(Boolean);
            prenom = parts.shift() || '';
            nom = parts.join(' ');

        } else {
            // === AuréHAL : ID auteur dans le chemin de l'URL, nom via l'API HAL ===
            let idAur = window.location.pathname.replace(/^\/|\/$/g, '').split('/').pop() || '';
            if (!idAur) { createPopup('<b>Impossible de déterminer l\'ID auteur depuis l\'URL.</b>'); return; }

            const isCreatePage = /\/create\//i.test(window.location.pathname);

            // Récupération prénom/nom depuis l'API HAL
            if (!isCreatePage) {
                try {
                    let r = await fetch(`https://api.archives-ouvertes.fr/search/?q=authIdPerson_i:${idAur}&fl=authLastName_s,authFirstName_s,authIdPerson_i&rows=50&wt=json`);
                    if (r.ok) {
                        let data = await r.json();
                        for (const doc of (data.response?.docs || [])) {
                            let ids = Array.isArray(doc.authIdPerson_i) ? doc.authIdPerson_i : [doc.authIdPerson_i];
                            let idx = ids.findIndex(id => String(id) === String(idAur));
                            if (idx !== -1) {
                                prenom = (doc.authFirstName_s || [])[idx] || '';
                                nom    = (doc.authLastName_s  || [])[idx] || '';
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }
            // Fallback DOM si l'API HAL n'a rien retourné
            if (!prenom && !nom) {
                let header = document.querySelector('h3.mb-4') ||
                    Array.from(document.querySelectorAll('h3')).find(h =>
                        /Modifications des informations de/i.test(h.innerText) ||
                        /Auteur\s*:/i.test(h.innerText) ||
                        /Création d'un auteur identifié/i.test(h.innerText)
                    );
                if (header) {
                    let t = header.innerText.trim();
                    let m = t.match(/Auteur\s*:\s*(.+)/i) || t.match(/Modifications des informations de\s+(.+)/i);
                    if (m) {
                        let parts = m[1].trim().split(/\s+/).filter(Boolean);
                        prenom = parts.shift() || '';
                        nom = parts.join(' ') || '';
                    }
                    if (!prenom && !nom && /Création d'un auteur identifié/i.test(t)) {
                        let li = document.querySelector('#sortable-form li[data-firstname][data-lastname]');
                        if (li) {
                            prenom = li.getAttribute('data-firstname') || '';
                            nom    = li.getAttribute('data-lastname')  || '';
                        }
                    }
                }
            }
        }

        if (!prenom && !nom) { createPopup("<b>Impossible de déterminer le nom de l'auteur.</b>"); return; }

        let nomTrouve = `${prenom} ${nom}`.trim();

        // Construction des requêtes IdRef, ORCID et (SoVisu+ uniquement) idHAL
        let qUrl = `https://www.idref.fr/Sru/Solr?q=${encodeURIComponent(`persname_t:(${nom} AND ${prenom})`)}&fl=id,ppn_z,affcourt_z,recordtype_z&rows=20&wt=json`;
        let orcidUrl = `https://pub.orcid.org/v3.0/search/?q=family-name:${encodeURIComponent(stripAccents(nom))}+AND+given-names:${encodeURIComponent(stripAccents(prenom))}&rows=8`;
        let halAuthUrl = `https://api.archives-ouvertes.fr/ref/author/?q=${encodeURIComponent(`fullName_t:"${prenom} ${nom}"`)}&fl=fullName_s,idHal_s,person_i,valid_s&rows=20&wt=json`;

        // Requêtes parallèles IdRef + ORCID (+ idHAL sur SoVisu+)
        let [r2, r3, r4] = await Promise.allSettled([
            fetch(qUrl),
            fetch(orcidUrl, { headers: { 'Accept': 'application/json' } }),
            isSovisu ? fetch(halAuthUrl) : Promise.resolve(null)
        ]);

        let idrefJson = null;
        if (r2.status === 'fulfilled' && r2.value.ok) {
            try { let txt = await r2.value.text(); if (txt.trim().startsWith('{')) idrefJson = JSON.parse(txt); } catch(e) {}
        }
        let orcidData = null;
        if (r3.status === 'fulfilled' && r3.value.ok) {
            try { orcidData = await r3.value.json(); } catch(e) {}
        }
        let halAuthData = null;
        if (isSovisu && r4.status === 'fulfilled' && r4.value?.ok) {
            try { halAuthData = await r4.value.json(); } catch(e) {}
        }

        let html = `<div style="padding:6px;"><b>Résultats pour ${escapeHtml(nomTrouve)} :</b>`;

        // === IdRef ===
        html += `<div style="margin-top:10px;"><h3 style="background:#E3F2FD;padding:6px;margin:0;">📚 IdRef</h3><ul style="padding-left:14px;margin-top:8px;">`;

        let docs = idrefJson?.response?.docs || [];
        let items = docs.map(x => ({ ppn: x.ppn_z || x.id || '', lib: x.affcourt_z || x.recordtype_z || '' })).filter(it => it.ppn);

        if (items.length) {
            // Fetch des détails de chaque PPN en parallèle
            let details = await Promise.allSettled(items.map(it =>
                fetch(`https://www.idref.fr/${it.ppn}.json`).then(r => r.ok ? r.json() : Promise.reject())
            ));

            for (let i = 0; i < items.length; i++) {
                const { ppn, lib } = items[i];
                let bioHtml = '', orcidHtml = '', halHtml = '';
                const dr = details[i];

                if (dr.status === 'fulfilled' && Array.isArray(dr.value?.record?.datafield)) {
                    const fields = dr.value.record.datafield;
                    const subs = f => Array.isArray(f.subfield) ? f.subfield : [f.subfield];
                    const sub = (f, code) => subs(f).find(s => String(s.code) === code)?.content;

                    // Biographie (tag 340)
                    let bioField = fields.find(f => String(f.tag) === '340');
                    if (bioField) {
                        let bio = String(sub(bioField, 'a') || '');
                        if (bio) {
                            let bioShort = bio.length > 100 ? bio.substring(0, 100) + '...' : bio;
                            bioHtml = `<div style="margin-top:3px;font-size:12px;color:#555;font-style:italic;cursor:help;" title="${escapeAttr(bio)}">${escapeHtml(bioShort)}</div>`;
                        }
                    }

                    // ORCID (tag 035, code 2 = "ORCID")
                    let orcidField = fields.filter(f => String(f.tag) === '035')
                        .find(f => subs(f).find(s => String(s.code) === '2' && String(s.content).toUpperCase() === 'ORCID'));
                    if (orcidField) {
                        let orcid = String(sub(orcidField, 'a') || '');
                        if (orcid) orcidHtml = `<div style="margin-top:3px;"><b>ORCID :</b> <a href="https://orcid.org/${escapeAttr(orcid)}" target="_blank" rel="noopener">${escapeHtml(orcid)}</a> <button data-copy="${escapeAttr(orcid)}" style="border:none;background:#81C784;color:white;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">📋</button></div>`;
                    }

                    // ID HAL
                    let halField = fields.filter(f => String(f.tag) === '035')
                        .find(f => subs(f).find(s => String(s.code) === '2' && String(s.content).toUpperCase() === 'HAL'));
                    if (halField) {
                        let idHal = String(sub(halField, 'a') || '');
                        if (idHal) halHtml = `<div style="margin-top:3px;"><b>IDHAL :</b> ${escapeHtml(idHal)} <button data-copy="${escapeAttr(idHal)}" style="border:none;background:#1565C0;color:white;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">📋</button></div>`;
                    }

                    // Affiliations (tag 510)
                    let affFields = fields.filter(f => String(f.tag) === '510');
                    if (affFields.length) {
                        let affList = affFields.map(f => ({
                            name: String(sub(f, 'a') || ''),
                            year: (String(sub(f, '0') || '').match(/^(\d{4})/) || [])[1] || ''
                        })).filter(a => a.name);
                        if (affList.length) {
                            bioHtml += `<div style="margin-top:5px;font-size:12px;color:#444;"><b>Affiliation(s) :</b><br/>`;
                            for (const aff of affList) {
                                bioHtml += `<span style="margin-left:8px;">• ${escapeHtml(aff.name)}`;
                                if (aff.year) bioHtml += ` <i>(depuis ${aff.year})</i>`;
                                bioHtml += `</span><br/>`;
                            }
                            bioHtml += `</div>`;
                        }
                    }
                }

                html += `<li style="margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #eee;">
                           <a href="https://www.idref.fr/${escapeAttr(ppn)}" target="_blank" rel="noopener"><b>${escapeHtml(lib)}</b></a>
                           ${bioHtml}
                           <div style="margin-top:4px;"><b>IDREF :</b> ${escapeHtml(ppn)} <button data-copy="${escapeAttr(ppn)}" style="border:none;background:#64B5F6;color:white;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">📋</button>${orcidHtml}${halHtml}</div>
                         </li>`;
            }
        } else {
            html += `<li>Aucun résultat</li>`;
        }
        html += `</ul></div>`;

                // === HAL (SoVisu+ uniquement) ===
        if (isSovisu) {
            html += `<div style="margin-top:15px;"><h3 style="background:#f5eada;padding:6px;margin:0;">🔓 HAL</h3><ul style="padding-left:14px;margin-top:8px;">`;
            const st = v => String(v || '').toUpperCase();
            const badgeInfo = {
                PREFERRED: { txt: 'PREF',  bg: '#2E7D32', fg: 'white' },
                VALID:     { txt: 'VALID', bg: '#2E7D32', fg: 'white' },
                OLD:       { txt: 'OLD',   bg: '#F9A825', fg: '#333' }
            };
            const statusRank = { PREFERRED: 0, VALID: 1, OLD: 2 };
            const copyBtn = v => `<button data-copy="${escapeAttr(v)}" style="border:none;background:#f5eada;color:white;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">📋</button>`;

            // On écarte les formes INCOMING ; tri : formes avec identifiant d'abord, puis par statut
            let halDocs = (halAuthData?.response?.docs || [])
                .filter(d => st(d.valid_s) !== 'INCOMING')
                .sort((a, b) =>
                    ((a.idHal_s ? 0 : 1) - (b.idHal_s ? 0 : 1)) ||
                    ((statusRank[st(a.valid_s)] ?? 3) - (statusRank[st(b.valid_s)] ?? 3))
                );

            if (halDocs.length) {
                for (const d of halDocs) {
                    const idAut = d.person_i;
                    const b = badgeInfo[st(d.valid_s)] || { txt: String(d.valid_s || '?').slice(0, 6), bg: '#9E9E9E', fg: 'white' };
                    let lines = '';

                    if (d.idHal_s) {
                        lines += `<div style="margin-top:4px;"><b>IDHAL :</b> <a href="https://cv.hal.science/${escapeAttr(d.idHal_s)}" target="_blank" rel="noopener">${escapeHtml(d.idHal_s)}</a> ${copyBtn(d.idHal_s)}</div>`;
                    }
                    if (idAut) {
                        lines += `<div style="margin-top:4px;"><b>IDAUTEUR :</b> <a href="https://aurehal.archives-ouvertes.fr/person/read/id/${escapeAttr(idAut)}" target="_blank" rel="noopener">${escapeHtml(idAut)}</a> ${copyBtn(idAut)}</div>`;
                    }
                    if (!lines) {
                        lines = `<div style="margin-top:4px;font-size:12px;color:#777;">Pas d'idHAL ni d'idAuteur</div>`;
                    }

                    html += `<li style="margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #eee;">
                               <b>${escapeHtml(d.fullName_s || '—')}</b><span title="${escapeAttr(d.valid_s || 'statut inconnu')}" style="display:inline-block;margin-left:6px;padding:1px 5px;border-radius:3px;font-size:11px;background:${b.bg};color:${b.fg};cursor:help;">${escapeHtml(b.txt)}</span>
                               ${lines}
                             </li>`;
                }
            } else {
                html += `<li>Aucun résultat</li>`;
            }
            html += `</ul></div>`;
        }

        // === ORCID ===
        html += `<div style="margin-top:15px;"><h3 style="background:#E8F5E9;padding:6px;margin:0;">🔬 ORCID</h3><ul style="padding-left:14px;margin-top:8px;">`;
        let orcidIds = (orcidData?.result || []).map(item => item['orcid-identifier']?.path).filter(p => p);
        if (orcidIds.length) {
            let [profiles, employments] = await Promise.all([
                Promise.allSettled(orcidIds.map(oid =>
                    fetch(`https://pub.orcid.org/v3.0/${oid}/person`, { headers: { 'Accept': 'application/json' } })
                        .then(r => r.ok ? r.json() : null)
                )),
                Promise.allSettled(orcidIds.map(oid =>
                    fetch(`https://pub.orcid.org/v3.0/${oid}/employments`, { headers: { 'Accept': 'application/json' } })
                        .then(r => r.ok ? r.json() : null)
                ))
            ]);

            for (let i = 0; i < orcidIds.length; i++) {
                let oid = orcidIds[i];
                let profile = profiles[i].status === 'fulfilled' ? profiles[i].value : null;
                let empData = employments[i].status === 'fulfilled' ? employments[i].value : null;

                let displayName = oid;
                if (profile?.name) {
                    let gn = profile.name['given-names']?.value || '';
                    let fn = profile.name['family-name']?.value || '';
                    displayName = `${gn} ${fn}`.trim() || oid;
                }

                // Extraire les emplois
                let currentEmp = (empData?.['affiliation-group'] || [])
                    .flatMap(g => g.summaries?.map(s => s['employment-summary']) || [])
                    .filter(e => e && !e['end-date'])  // pas de date de fin = actuel
                    .map(e => e.organization?.name)
                    .filter(name => name);

                let empHtml = '';
                if (currentEmp.length) {
                    empHtml = `<div style="font-size:12px;color:#555;font-style:italic;margin-top:3px;">${currentEmp.map(n => escapeHtml(n)).join(', ')}</div>`;
                }

                html += `<li style="margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #eee;">
                           <a href="https://orcid.org/${escapeAttr(oid)}" target="_blank" rel="noopener"><b>${escapeHtml(displayName)}</b></a>
                           <div style="margin-top:3px;color:#666;font-size:13px;">${escapeHtml(oid)} <button data-copy="${escapeAttr(oid)}" style="border:none;background:#81C784;color:white;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">📋</button></div>
                           ${empHtml}
                         </li>`;
            }
        } else {
            html += `<li>Aucun résultat</li>`;
        }

        html += `</ul></div></div>`;
        createPopup(html);

    } catch(e) {
        createPopup('Erreur : ' + escapeHtml(e?.message || String(e)));
    }
})();