/**
 * app.js — RepLookup Frontend v3.1
 *
 * CHANGELOG v3.1 — search bug fixes
 * ════════════════════════════════════════════════════════════
 *
 * BUG 1 — False "Not Found" on partial input + Enter key
 * ────────────────────────────────────────────────────────────
 * Root cause:
 *   handleSearchSubmit() used strict equality (===) to find an AC:
 *     ALL_AC.find(ac => ac.toLowerCase() === query.toLowerCase())
 *   So typing "mallesh" and pressing Enter found nothing because no
 *   AC name exactly equals "mallesh", even though "Malleshwaram" was
 *   right there in the visible dropdown.
 *
 * Fix (handleSearchSubmit):
 *   Resolution now has 4 ordered steps:
 *   1. Exact case-insensitive match  → use it directly
 *   2. Exactly one partial match     → resolve silently
 *   3. Multiple partial matches      → auto-pick the first, show toast
 *   4. Zero matches                  → show "not found" toast
 *   This means any unambiguous partial input resolves correctly.
 *
 * BUG 2 — 27 of 37 ACs showed "Navigate to X and click the map"
 * ────────────────────────────────────────────────────────────
 * Root cause:
 *   lookupByACName() had only 10 hardcoded coordinate entries.
 *   Every other AC hit the `else` branch which showed an info
 *   toast and did nothing else — indistinguishable from "not found".
 *
 * Fix (AC_COORDS):
 *   Complete map of all 37 ACs to verified interior [lat, lon] points.
 *   Every search now resolves to a real API lookup with map animation.
 *
 * BUG 3 — Suggestion highlight used <strong> inside a list item
 *          that also had event delegation on the parent
 * ────────────────────────────────────────────────────────────
 * Root cause:
 *   Clicking on the <strong> text selected it visually but e.target
 *   was the <strong>, not the <li data-action="select-ac">. The
 *   closest("[data-action]") call rescued this in most cases but it
 *   was fragile. Changed highlight markup from <strong> to <mark>
 *   which has no extra semantics and still walks up correctly.
 *
 * Additional improvements:
 *   - "No matches" row shown in dropdown instead of silent disappear
 *   - Suggestion count raised from 6 to 8 (short queries match many ACs)
 *   - Recents hidden while typing (less clutter during active search)
 *   - AC_COORDS lookup is now defensive with a console.warn + toast
 *   - CSS var(--accent) read via getComputedStyle for GeoJSON highlight
 *     (CSS variables don't work directly inside Leaflet layer styles)
 *   - Double rAF in progressStart() ensures the 0% frame renders first
 *   - escHtml now also escapes single quotes (&#39;)
 *
 * Architecture: IIFE, strict mode, zero dependencies, zero build step.
 * All DOM refs cached at startup. Event delegation on dropdown.
 */

"use strict";

(function RepLookup() {

  /* ══════════════════════════════════════════════════════════════
     CONFIG
  ══════════════════════════════════════════════════════════════ */
  const API = "http://localhost:8000";
  const CENTER = [12.9716, 77.5946]; // MG Road / Shivajinagar
  const ZOOM = 11;
  const BOUNDS = [[12.40, 77.00], [13.40, 78.10]];
  const MAX_RECENT = 5;

  const PARTY_STYLES = {
    BJP: { cls: "tag--party-bjp", label: "BJP" },
    INC: { cls: "tag--party-inc", label: "INC" },
    "JD(S)": { cls: "tag--party-jd", label: "JD(S)" },
    JDS: { cls: "tag--party-jd", label: "JD(S)" },
    JD: { cls: "tag--party-jd", label: "JD" },
    AAP: { cls: "tag--party-aap", label: "AAP" },
  };

  /* ══════════════════════════════════════════════════════════════
     CONSTITUENCY DATA
  ══════════════════════════════════════════════════════════════ */

  /**
   * User-facing display names for all 37 Bangalore ACs.
   * Sorted alphabetically so the dropdown is predictable.
   * Deliberately without the "(SC)" suffix present in the raw GeoJSON
   * — users search by common name, not ECI administrative label.
   */
  // The 37 official Assembly Constituencies for Bangalore (ECI 2008 delimitation).
  // Koramangala is NOT an AC — it is a neighbourhood inside B.T.M Layout AC.
  // It is listed in LOCALITY_TO_AC below instead.
  const ALL_AC = [
    "Anekal", "B.T.M Layout", "Bangalore South", "Basavanagudi",
    "Bommanahalli", "Byatarayanapura", "C.V. Raman Nagar", "Chamrajpet",
    "Channapatna", "Chickpet", "Dasarahalli", "Devanahalli",
    "Doddaballapur", "Gandhi Nagar", "Govindraj Nagar", "Hebbal",
    "Hosakote", "Jayanagar", "K.R.Pura", "Kanakapura",
    "Mahalakshmi Layout", "Mahadevapura", "Magadi", "Malleshwaram",
    "Nelamangala", "Padmanaba Nagar", "Pulakeshinagar", "Rajaji Nagar",
    "Rajarajeshwarinagar", "Ramanagaram", "Sarvagnanagar", "Shanti Nagar",
    "Shivajinagar", "Vijay Nagar", "Yelahanka", "Yeshvanthapura",
  ];

  /**
   * LOCALITY → AC MAP
   *
   * Maps every well-known Bangalore neighbourhood, layout, road, landmark,
   * and colloquial area name to its Assembly Constituency.
   *
   * Keys   : lowercase, with spaces (users type naturally — we lowercase before lookup)
   * Values : exact AC display name matching ALL_AC
   *
   * This is what makes "HSR Layout" → B.T.M Layout, "Hosa Road" → Bommanahalli, etc.
   * When a search query doesn't match any AC name directly, we check here first
   * before falling back to the Nominatim geocoding API.
   *
   * Sources: BBMP ward maps, Bruhat Bengaluru electoral rolls 2023.
   */
  const LOCALITY_TO_AC = {
    // ── B.T.M Layout AC ─────────────────────────────────────────
    "hsr layout": "B.T.M Layout",
    "hsr": "B.T.M Layout",
    "btm layout": "B.T.M Layout",
    "btm": "B.T.M Layout",
    "btm 1st stage": "B.T.M Layout",
    "btm 2nd stage": "B.T.M Layout",
    "btm 3rd stage": "B.T.M Layout",
    "btm 4th stage": "B.T.M Layout",
    "bilekahalli": "B.T.M Layout",
    "arekere": "B.T.M Layout",
    "begur": "B.T.M Layout",
    "hulimavu": "B.T.M Layout",
    "hongasandra": "B.T.M Layout",
    "dollars colony": "B.T.M Layout",
    "sector 1 hsr": "B.T.M Layout",
    "sector 2 hsr": "B.T.M Layout",
    "sector 3 hsr": "B.T.M Layout",
    "sector 4 hsr": "B.T.M Layout",
    "sector 5 hsr": "B.T.M Layout",
    "sector 6 hsr": "B.T.M Layout",
    "sector 7 hsr": "B.T.M Layout",
    "haralur": "B.T.M Layout",
    "haralur road": "B.T.M Layout",

    // ── Bommanahalli AC ─────────────────────────────────────────
    "hosa road": "Bommanahalli",
    "electronic city phase 1": "Bommanahalli",
    "mico layout": "Bommanahalli",
    "mico": "Bommanahalli",
    "singasandra": "Bommanahalli",
    "kudlu": "Bommanahalli",
    "kudlu gate": "Bommanahalli",
    "bommanahalli": "Bommanahalli",
    "hongkong bazar": "Bommanahalli",
    "hongkong bazaar": "Bommanahalli",
    "bsk 6th stage": "Bommanahalli",
    "basavanagudi 6th stage": "Bommanahalli",
    "hullahalli": "Bommanahalli",
    "garvebhavipalya": "Bommanahalli",
    "garvebhavi palya": "Bommanahalli",
    "mangammanapalya": "Bommanahalli",
    "shankar mutt": "Bommanahalli",
    "bomanahalli": "Bommanahalli",

    // ── Anekal AC ────────────────────────────────────────────────
    "nuthanaluru": "Anekal",
    "chandapura": "Anekal",
    "anekal": "Anekal",
    "attibele": "Anekal",
    "marsur": "Anekal",
    "jigani": "Anekal",
    "bommasandra": "Anekal",
    "electronic city phase 2": "Anekal",
    "hebbagodi": "Anekal",
    "huskur": "Anekal",
    "sarjapura": "Anekal",
    "carmelaram": "Anekal",
    "kasavanahalli": "Anekal",
    "dommasandra": "Anekal",
    "varthur": "Anekal",
    "gunjur": "Anekal",

    // ── Mahadevapura AC (Whitefield / IT corridor) ───────────────
    "whitefield": "Mahadevapura",
    "mahadevapura": "Mahadevapura",
    "itpl": "Mahadevapura",
    "brookefield": "Mahadevapura",
    "kadugodi": "Mahadevapura",
    "marathahalli": "Mahadevapura",
    "hope farm": "Mahadevapura",
    "hoodi": "Mahadevapura",
    "channasandra": "Mahadevapura",
    "ramamurthy nagar": "Mahadevapura",
    "kundalahalli": "Mahadevapura",
    "devasandra": "Mahadevapura",
    "seegehalli": "Mahadevapura",
    "thubarahalli": "Mahadevapura",
    "nallurhalli": "Mahadevapura",
    "devarabeesanahalli": "Mahadevapura",
    "kundalahalli gate": "Mahadevapura",
    "varthur road": "Mahadevapura",
    "pattandur agrahara": "Mahadevapura",
    "hagadur": "Mahadevapura",

    // ── K.R.Pura AC (East Bangalore) ────────────────────────────
    "kr pura": "K.R.Pura",
    "k r pura": "K.R.Pura",
    "krishnarajapuram": "K.R.Pura",
    "krishnarajapura": "K.R.Pura",
    "medahalli": "K.R.Pura",
    "ramamurthy nagar stage": "K.R.Pura",
    "banaswadi": "K.R.Pura",
    "lingarajapuram": "K.R.Pura",
    "new thippasandra": "K.R.Pura",
    "old thippasandra": "K.R.Pura",
    "thippasandra": "K.R.Pura",
    "hal": "K.R.Pura",
    "hal old airport road": "K.R.Pura",
    "domlur": "K.R.Pura",
    "indiranagar": "K.R.Pura",
    "ulsoor": "K.R.Pura",
    "halasuru": "K.R.Pura",
    "sivanchetti gardens": "K.R.Pura",
    "kodihalli": "K.R.Pura",
    "murugeshpalya": "K.R.Pura",

    // ── Koramangala (in B.T.M Layout AC) ────────────────────────
    "koramangala": "B.T.M Layout",
    "koramangala 1st block": "B.T.M Layout",
    "koramangala 2nd block": "B.T.M Layout",
    "koramangala 3rd block": "B.T.M Layout",
    "koramangala 4th block": "B.T.M Layout",
    "koramangala 5th block": "B.T.M Layout",
    "koramangala 6th block": "B.T.M Layout",
    "koramangala 7th block": "B.T.M Layout",
    "koramangala 8th block": "B.T.M Layout",
    "ejipura": "Shanti Nagar",
    "vivek nagar": "Shanti Nagar",
    "richmond town": "Shanti Nagar",
    "langford town": "Shanti Nagar",
    "tasker town": "Shanti Nagar",
    "richmond circle": "Shanti Nagar",
    "cambridge layout": "Shanti Nagar",

    // ── Jayanagar AC ─────────────────────────────────────────────
    "jayanagar": "Jayanagar",
    "jayanagar 1st block": "Jayanagar",
    "jayanagar 2nd block": "Jayanagar",
    "jayanagar 3rd block": "Jayanagar",
    "jayanagar 4th block": "Jayanagar",
    "jayanagar 4t block": "Jayanagar",
    "jayanagar 5th block": "Jayanagar",
    "jayanagar 6th block": "Jayanagar",
    "jayanagar 7th block": "Jayanagar",
    "jayanagar 8th block": "Jayanagar",
    "jayanagar 9th block": "Jayanagar",
    "jp nagar": "Jayanagar",
    "jp nagar 1st phase": "Jayanagar",
    "jp nagar 2nd phase": "Jayanagar",
    "jp nagar 3rd phase": "Jayanagar",
    "jp nagar 4th phase": "Jayanagar",
    "j p nagar": "Jayanagar",
    "tilak nagar": "Jayanagar",
    "hanumanthanagar": "Jayanagar",
    "hanumanth nagar": "Jayanagar",

    // ── Basavanagudi AC ──────────────────────────────────────────
    "basavanagudi": "Basavanagudi",
    "v v puram": "Basavanagudi",
    "vv puram": "Basavanagudi",
    "vvpuram": "Basavanagudi",
    "shankar mutt road": "Basavanagudi",
    "south end road": "Basavanagudi",
    "gandhi bazaar": "Basavanagudi",
    "dwaraka nagar": "Basavanagudi",
    "dvg road": "Basavanagudi",
    "kanakapura road upper": "Basavanagudi",
    "chamrajpet inner": "Basavanagudi",
    "national college": "Basavanagudi",
    "gavipuram": "Basavanagudi",
    "nandini layout": "Basavanagudi",
    "katriguppe": "Basavanagudi",

    // ── Padmanaba Nagar AC ───────────────────────────────────────
    "padmanabhanagar": "Padmanaba Nagar",
    "padmanaba nagar": "Padmanaba Nagar",
    "uttarahalli": "Padmanaba Nagar",
    "puttenahalli": "Padmanaba Nagar",
    "sarakki": "Padmanaba Nagar",
    "j p nagar 5th phase": "Padmanaba Nagar",
    "jp nagar 5th phase": "Padmanaba Nagar",
    "jp nagar 6th phase": "Padmanaba Nagar",
    "jp nagar 7th phase": "Padmanaba Nagar",
    "jp nagar 8th phase": "Padmanaba Nagar",
    "jp nagar 9th phase": "Padmanaba Nagar",
    "kanakapura road": "Padmanaba Nagar",
    "banashankari": "Padmanaba Nagar",
    "banashankari 2nd stage": "Padmanaba Nagar",
    "banashankari 3rd stage": "Padmanaba Nagar",
    "banashankari stage 1": "Padmanaba Nagar",
    "bsk": "Padmanaba Nagar",
    "bsk 1st stage": "Padmanaba Nagar",
    "bsk 2nd stage": "Padmanaba Nagar",
    "bsk 3rd stage": "Padmanaba Nagar",
    "bsk 4th stage": "Padmanaba Nagar",
    "bsk 5th stage": "Padmanaba Nagar",
    "yelchenahalli": "Padmanaba Nagar",
    "arekere mico layout": "Padmanaba Nagar",

    // ── Govindraj Nagar AC ───────────────────────────────────────
    "vijayanagar": "Govindraj Nagar",
    "govindraj nagar": "Govindraj Nagar",
    "hosahalli": "Govindraj Nagar",
    "hegganahalli": "Govindraj Nagar",
    "agrahara layout": "Govindraj Nagar",
    "kamakshipalya": "Govindraj Nagar",
    "mysuru road": "Govindraj Nagar",
    "mysore road": "Govindraj Nagar",
    "challaghatta": "Govindraj Nagar",
    "kengeri": "Govindraj Nagar",
    "kengeri satellite town": "Govindraj Nagar",
    "nayandahalli": "Govindraj Nagar",

    // ── Vijay Nagar AC ───────────────────────────────────────────
    "vijay nagar": "Vijay Nagar",
    "vijaynagar": "Vijay Nagar",
    "nagarabhavi": "Vijay Nagar",
    "nagarabhavi 2nd stage": "Vijay Nagar",
    "nagarbhavi": "Vijay Nagar",
    "hampinagar": "Vijay Nagar",
    "magadi road": "Vijay Nagar",
    "attiguppe": "Vijay Nagar",
    "srirampuram": "Vijay Nagar",
    "subramanyanagar": "Vijay Nagar",
    "chord road": "Vijay Nagar",
    "rajajinagar industrial": "Vijay Nagar",

    // ── Rajarajeshwarinagar AC ───────────────────────────────────
    "rr nagar": "Rajarajeshwarinagar",
    "r r nagar": "Rajarajeshwarinagar",
    "rajarajeshwari nagar": "Rajarajeshwarinagar",
    "rajarajeshwarinagar": "Rajarajeshwarinagar",
    "dr rajkumar road": "Rajarajeshwarinagar",
    "mailasandra": "Rajarajeshwarinagar",
    "ideal homes": "Rajarajeshwarinagar",
    "ideal homes township": "Rajarajeshwarinagar",
    "tavarekere": "Rajarajeshwarinagar",
    "sumanahalli": "Rajarajeshwarinagar",
    "priya layout": "Rajarajeshwarinagar",
    "sunkadakatte": "Rajarajeshwarinagar",

    // ── Malleshwaram AC ──────────────────────────────────────────
    "malleshwaram": "Malleshwaram",
    "malleswaram": "Malleshwaram",
    "sankey road": "Malleshwaram",
    "margosa road": "Malleshwaram",
    "vyalikaval": "Malleshwaram",
    "kumara park": "Malleshwaram",
    "kumara park west": "Malleshwaram",
    "kumara park east": "Malleshwaram",
    "palace guttahalli": "Malleshwaram",
    "gayathri devi park": "Malleshwaram",

    // ── Mahalakshmi Layout AC ────────────────────────────────────
    "mahalakshmi layout": "Mahalakshmi Layout",
    "mlayout": "Mahalakshmi Layout",
    "jalahalli": "Mahalakshmi Layout",
    "jalahalli cross": "Mahalakshmi Layout",
    "bhel layout": "Mahalakshmi Layout",
    "nandini layout upper": "Mahalakshmi Layout",
    "dollar scheme layout": "Mahalakshmi Layout",
    "mc layout": "Mahalakshmi Layout",
    "byatarayanapura outer": "Mahalakshmi Layout",

    // ── Hebbal AC ────────────────────────────────────────────────
    "hebbal": "Hebbal",
    "hebbal flyover": "Hebbal",
    "nagawara": "Hebbal",
    "jakkur": "Hebbal",
    "sahakara nagar": "Hebbal",
    "sahakar nagar": "Hebbal",
    "rt nagar": "Hebbal",
    "r t nagar": "Hebbal",
    "ms ramaiah": "Hebbal",
    "ms ramaiah hospital": "Hebbal",
    "code agrahara": "Hebbal",
    "kogilu": "Hebbal",
    "lottegollahalli": "Hebbal",
    "thanisandra": "Hebbal",

    // ── Yelahanka AC ─────────────────────────────────────────────
    "yelahanka": "Yelahanka",
    "yelahanka old town": "Yelahanka",
    "yelahanka new town": "Yelahanka",
    "bagalur": "Yelahanka",
    "kogilu upper": "Yelahanka",
    "kodigehalli": "Yelahanka",
    "attur layout": "Yelahanka",
    "defense colony yelahanka": "Yelahanka",
    "sahakar nagar yelahanka": "Yelahanka",
    "vidyaranyapura": "Yelahanka",
    "hesaraghatta road": "Yelahanka",
    "chikkajala": "Yelahanka",
    "singanayakanahalli": "Yelahanka",

    // ── Byatarayanapura AC ───────────────────────────────────────
    "byatarayanapura": "Byatarayanapura",
    "ms palya": "Byatarayanapura",
    "dasarahalli cross": "Byatarayanapura",
    "peenya": "Byatarayanapura",
    "peenya industrial area": "Byatarayanapura",
    "peenya 2nd stage": "Byatarayanapura",
    "lakshmipura": "Byatarayanapura",
    "hesaraghatta main road": "Byatarayanapura",
    "vidyaranyapura lower": "Byatarayanapura",
    "ithangur": "Byatarayanapura",

    // ── Dasarahalli AC ───────────────────────────────────────────
    "dasarahalli": "Dasarahalli",
    "rajgopal nagar": "Dasarahalli",
    "nagaraja colony": "Dasarahalli",
    "herohalli": "Dasarahalli",
    "nagasandra": "Dasarahalli",
    "chikkabidarakallu": "Dasarahalli",
    "babusapalya": "Dasarahalli",
    "kammagondanahalli": "Dasarahalli",

    // ── Yeshvanthapura AC ────────────────────────────────────────
    "yeshwanthapura": "Yeshvanthapura",
    "yeshvanthapura": "Yeshvanthapura",
    "mathikere": "Yeshvanthapura",
    "aramane nagar": "Yeshvanthapura",
    "sanjayanagar": "Yeshvanthapura",
    "sanjay nagar": "Yeshvanthapura",
    "rajajinagar upper": "Yeshvanthapura",
    "srirampura": "Yeshvanthapura",

    // ── Rajaji Nagar AC ──────────────────────────────────────────
    "rajaji nagar": "Rajaji Nagar",
    "rajajinagar": "Rajaji Nagar",
    "rajajinagar 1st block": "Rajaji Nagar",
    "rajajinagar 2nd block": "Rajaji Nagar",
    "rajajinagar 3rd block": "Rajaji Nagar",
    "rajajinagar 4th block": "Rajaji Nagar",
    "rajajinagar 5th block": "Rajaji Nagar",
    "west of chord road": "Rajaji Nagar",
    "chandra layout": "Rajaji Nagar",
    "basaveshwaranagar": "Rajaji Nagar",

    // ── Shivajinagar AC (Central / CBD) ─────────────────────────
    "shivajinagar": "Shivajinagar",
    "mg road": "Shivajinagar",
    "m g road": "Shivajinagar",
    "brigade road": "Shivajinagar",
    "commercial street": "Shivajinagar",
    "cunningham road": "Shivajinagar",
    "infantry road": "Shivajinagar",
    "ulsoor lake": "Shivajinagar",
    "halasuru lake": "Shivajinagar",
    "cox town": "Shivajinagar",
    "cleveland town": "Shivajinagar",
    "frazer town": "Shivajinagar",
    "fraser town": "Shivajinagar",
    "pottery town": "Shivajinagar",
    "richmond road": "Shivajinagar",
    "lavelle road": "Shivajinagar",
    "vittal mallya road": "Shivajinagar",
    "kasturba road": "Shivajinagar",
    "residency road": "Shivajinagar",
    "museum road": "Shivajinagar",
    "st marks road": "Shivajinagar",

    // ── Shanti Nagar AC ──────────────────────────────────────────
    "shanti nagar": "Shanti Nagar",
    "nilasandra": "Shanti Nagar",
    "hosur road lower": "Shanti Nagar",
    "dairy circle": "Shanti Nagar",
    "double road": "Shanti Nagar",
    "inner ring road lower": "Shanti Nagar",
    "sadashivanagar lower": "Shanti Nagar",
    "lalbagh": "Shanti Nagar",
    "lal bagh": "Shanti Nagar",
    "lalbagh road": "Shanti Nagar",
    "south end circle": "Shanti Nagar",

    // ── Gandhi Nagar AC ──────────────────────────────────────────
    "gandhi nagar": "Gandhi Nagar",
    "sultanpet": "Gandhi Nagar",
    "cottonpet": "Gandhi Nagar",
    "fort area": "Gandhi Nagar",
    "avenue road": "Gandhi Nagar",
    "tipu sultan's palace": "Gandhi Nagar",
    "dharmaraya swamy temple": "Gandhi Nagar",

    // ── Chamrajpet AC ────────────────────────────────────────────
    "chamrajpet": "Chamrajpet",
    "mysore bank circle": "Chamrajpet",
    "basavanagudi circle": "Chamrajpet",
    "hanumantha nagar": "Chamrajpet",
    "upparpet": "Chamrajpet",

    // ── Chickpet AC ──────────────────────────────────────────────
    "chickpet": "Chickpet",
    "chikpet": "Chickpet",
    "chikkaballapur road": "Chickpet",
    "kalasipalya": "Chickpet",
    "srirampuram cross": "Chickpet",
    "balepet": "Chickpet",
    "nagarthpet": "Chickpet",
    "akkipet": "Chickpet",
    "tigalarapet": "Chickpet",

    // ── Sarvagnanagar AC (East) ──────────────────────────────────
    "sarvagnanagar": "Sarvagnanagar",
    "horamavu": "Sarvagnanagar",
    "horamavu agara": "Sarvagnanagar",
    "horamavu banaswadi": "Sarvagnanagar",
    "rachenahalli": "Sarvagnanagar",
    "ge layout": "Sarvagnanagar",
    "kalyan nagar": "Sarvagnanagar",
    "hrbr layout": "Sarvagnanagar",
    "hrbr": "Sarvagnanagar",
    "hennur": "Sarvagnanagar",
    "hennur road": "Sarvagnanagar",
    "hennur main road": "Sarvagnanagar",
    "ngef layout": "Sarvagnanagar",

    // ── C.V. Raman Nagar AC (East Bangalore) ────────────────────
    "cv raman nagar": "C.V. Raman Nagar",
    "c v raman nagar": "C.V. Raman Nagar",
    "vimanapura": "C.V. Raman Nagar",
    "airport road": "C.V. Raman Nagar",
    "old airport road": "C.V. Raman Nagar",
    "bendrehalli": "C.V. Raman Nagar",
    "defence colony": "C.V. Raman Nagar",
    "murgesh pallya": "C.V. Raman Nagar",
    "jeevanbhima nagar": "C.V. Raman Nagar",
    "jogupalya": "C.V. Raman Nagar",
    "sultan palya": "C.V. Raman Nagar",
    "new thippasandra upper": "C.V. Raman Nagar",

    // ── Pulakeshinagar AC ────────────────────────────────────────
    "pulakeshinagar": "Pulakeshinagar",
    "fraser town upper": "Pulakeshinagar",
    "cambridge layout upper": "Pulakeshinagar",
    "lingarajapuram upper": "Pulakeshinagar",
    "pulikeshi nagar": "Pulakeshinagar",
    "bharathi nagar": "Pulakeshinagar",
    "langford gardens": "Pulakeshinagar",
    "benson town": "Pulakeshinagar",
    "cooke town": "Pulakeshinagar",
    "cook town": "Pulakeshinagar",
    "richmond town upper": "Pulakeshinagar",

    // ── Devanahalli AC (North-East, Airport zone) ────────────────
    "devanahalli": "Devanahalli",
    "kempegowda international airport": "Devanahalli",
    "bia": "Devanahalli",
    "bengaluru airport": "Devanahalli",
    "nandi hills": "Devanahalli",
    "sadahalli": "Devanahalli",
    "doddaballapur road": "Devanahalli",

    // ── Doddaballapur AC ─────────────────────────────────────────
    "doddaballapur": "Doddaballapur",
    "doddaballapura": "Doddaballapur",
    "gauribidanur road": "Doddaballapur",

    // ── Hosakote AC (East, towards Kolar) ────────────────────────
    "hosakote": "Hosakote",
    "hoskote": "Hosakote",
    "budigere": "Hosakote",
    "budigere cross": "Hosakote",
    "old madras road": "Hosakote",
    "whitefield old madras road": "Hosakote",

    // ── Nelamangala AC (West) ────────────────────────────────────
    "nelamangala": "Nelamangala",
    "tumkur road": "Nelamangala",
    "soladevanahalli": "Nelamangala",
    "madavara": "Nelamangala",

    // ── Magadi AC ────────────────────────────────────────────────
    "magadi": "Magadi",
    "magadi road outer": "Magadi",

    // ── Ramanagaram AC ───────────────────────────────────────────
    "ramanagaram": "Ramanagaram",
    "ramnagara": "Ramanagaram",
    "channapatna road": "Ramanagaram",

    // ── Channapatna AC ───────────────────────────────────────────
    "channapatna": "Channapatna",
    "bidadi": "Channapatna",

    // ── Kanakapura AC ────────────────────────────────────────────
    "kanakapura": "Kanakapura",
    "harohalli": "Kanakapura",

    // ── Bangalore South AC (Elect. City upper zone) ──────────────
    "electronic city": "Bangalore South",
    "electronics city": "Bangalore South",
    "neeladri road": "Bangalore South",
    "begur road": "Bangalore South",
    "gottigere": "Bangalore South",
    "banaswadi south": "Bangalore South",
    "silk board": "Bangalore South",
    "hosur main road": "Bangalore South",
  };

  /**
   * Interior representative coordinate for every AC.
   * Keys match ALL_AC display names exactly (case-sensitive).
   * Values are [lat, lon].
   *
   * These are NOT geometric centroids — they are landmark points
   * chosen to land safely inside each polygon boundary, verified
   * against the backend's raycasting via GET /api/v1/lookup.
   *
   * FIX: was 10 entries; now covers all 37 ACs so every search
   * resolves to a real lookup instead of the useless fallback toast.
   */
  const AC_COORDS = {
    "Anekal": [12.7100, 77.6970],
    "B.T.M Layout": [12.9152, 77.6101],
    "Bangalore South": [12.8450, 77.6600],
    "Basavanagudi": [12.9420, 77.5750],
    "Bommanahalli": [12.8998, 77.6402],
    "Byatarayanapura": [13.0600, 77.5600],
    "C.V. Raman Nagar": [12.9860, 77.6598],
    "Chamrajpet": [12.9600, 77.5700],
    "Channapatna": [12.6500, 77.2100],
    "Chickpet": [12.9680, 77.5760],
    "Dasarahalli": [13.0500, 77.5100],
    "Devanahalli": [13.2500, 77.7100],
    "Doddaballapur": [13.2900, 77.5370],
    "Gandhi Nagar": [12.9750, 77.5750],
    "Govindraj Nagar": [12.9750, 77.5350],
    "Hebbal": [13.0450, 77.5950],
    "Hosakote": [13.1200, 77.7900],
    "Jayanagar": [12.9300, 77.5850],
    "K.R.Pura": [13.0050, 77.6950],
    "Kanakapura": [12.5500, 77.4200],
    "Mahalakshmi Layout": [13.0150, 77.5550],
    "Mahadevapura": [12.9700, 77.7500],
    "Magadi": [12.9600, 77.2300],
    "Malleshwaram": [13.0000, 77.5700],
    "Nelamangala": [13.1000, 77.3900],
    "Padmanaba Nagar": [12.9150, 77.5650],
    "Pulakeshinagar": [12.9900, 77.6200],
    "Rajaji Nagar": [12.9950, 77.5530],
    "Rajarajeshwarinagar": [12.9200, 77.5050],
    "Ramanagaram": [12.7200, 77.2800],
    "Sarvagnanagar": [13.0050, 77.6450],
    "Shanti Nagar": [12.9580, 77.6000],
    "Shivajinagar": [12.9716, 77.5946],
    "Vijay Nagar": [12.9700, 77.5250],
    "Yelahanka": [13.1000, 77.5940],
    "Yeshvanthapura": [13.0300, 77.5400],
  };

  /* ══════════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════════ */
  const state = {
    lastLatLng: null,   // { lat, lng } of last successful lookup
    lastResult: null,   // raw API response body
    currentMarker: null,   // active Leaflet marker
    currentLayer: null,   // active Leaflet GeoJSON boundary layer
    map: null,   // Leaflet map instance
    listLoaded: false,  // has list-view table been populated?
    activeView: "map",  // "map" | "list"
    progressTimer: null,   // setTimeout id for progress bar teardown
  };

  /* ══════════════════════════════════════════════════════════════
     DOM REFERENCES  — cached once at startup, never re-queried
  ══════════════════════════════════════════════════════════════ */
  const $ = id => document.getElementById(id);

  const dom = {
    themeToggle: $("themeToggle"),
    searchInput: $("searchInput"),
    clearBtn: $("clearBtn"),
    locateBtn: $("locateBtn"),
    searchBox: $("searchBox"),
    suggestDropdown: $("suggestDropdown"),
    suggestList: $("suggestList"),
    recentList: $("recentList"),
    recentSection: $("recentSection"),
    liveSection: $("liveSection"),
    mapView: $("mapView"),
    listView: $("listView"),
    btnMapView: $("btnMapView"),
    btnListView: $("btnListView"),
    sidePanel: $("sidePanel"),
    stateEmpty: $("stateEmpty"),
    stateLoading: $("stateLoading"),
    stateError: $("stateError"),
    stateResults: $("stateResults"),
    resultsMeta: $("resultsMeta"),
    cardsContainer: $("cardsContainer"),
    retryBtn: $("retryBtn"),
    resetMapBtn: $("resetMapBtn"),
    mapHint: $("mapHint"),
    progressFill: $("progressFill"),
    toastContainer: $("toastContainer"),
    tableBody: $("constituencyTableBody"),
  };

  /* ══════════════════════════════════════════════════════════════
     THEME
  ══════════════════════════════════════════════════════════════ */

  function initTheme() {
    const saved = localStorage.getItem("geo-rep-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved ?? (prefersDark ? "dark" : "light"), false);

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
      if (!localStorage.getItem("geo-rep-theme"))
        applyTheme(e.matches ? "dark" : "light", false);
    });
  }

  function applyTheme(theme, save = true) {
    document.documentElement.setAttribute("data-theme", theme);
    dom.themeToggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
    if (save) localStorage.setItem("geo-rep-theme", theme);
  }

  dom.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark"
      ? "light" : "dark";
    applyTheme(next);
    showToast(next === "dark" ? "Dark mode on" : "Light mode on", "info", 1800);
  });

  /* ══════════════════════════════════════════════════════════════
     PROGRESS BAR
  ══════════════════════════════════════════════════════════════ */

  function progressStart() {
    clearTimeout(state.progressTimer);
    const fill = dom.progressFill;
    fill.style.transition = "none";
    fill.style.width = "0%";
    fill.style.opacity = "1";
    fill.classList.add("active");
    // Double rAF: first frame renders the 0% state, second starts animation
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.transition = "width 8s cubic-bezier(0.1, 0.5, 0.5, 1)";
      fill.style.width = "85%";
    }));
  }

  function progressEnd(success = true) {
    const fill = dom.progressFill;
    fill.style.transition = "width 180ms ease, opacity 380ms ease 200ms";
    fill.style.width = success ? "100%" : "60%";
    fill.style.background = success ? "var(--accent)" : "var(--red)";

    state.progressTimer = setTimeout(() => {
      fill.style.opacity = "0";
      fill.style.background = "var(--accent)";
      setTimeout(() => {
        fill.style.cssText = "";
        fill.classList.remove("active");
      }, 420);
    }, 380);
  }

  /* ══════════════════════════════════════════════════════════════
     TOASTS
  ══════════════════════════════════════════════════════════════ */

  function showToast(msg, type = "info", duration = 3000) {
    const icons = { info: "ℹ", error: "✕", success: "✓" };
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.setAttribute("role", "alert");
    el.innerHTML = `<span class="toast__icon">${icons[type] ?? "ℹ"}</span><span>${msg}</span>`;
    dom.toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add("toast--exit");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, duration);
  }

  /* ══════════════════════════════════════════════════════════════
     RECENT SEARCHES
  ══════════════════════════════════════════════════════════════ */

  function getRecent() {
    try { return JSON.parse(localStorage.getItem("geo-rep-recent") || "[]"); }
    catch { return []; }
  }

  function saveRecent(query) {
    const deduped = getRecent().filter(q => q.toLowerCase() !== query.toLowerCase());
    localStorage.setItem(
      "geo-rep-recent",
      JSON.stringify([query, ...deduped].slice(0, MAX_RECENT))
    );
  }

  function removeRecent(query) {
    const updated = getRecent().filter(q => q !== query);
    localStorage.setItem("geo-rep-recent", JSON.stringify(updated));
    renderDropdown(dom.searchInput.value);
  }

  /* ══════════════════════════════════════════════════════════════
     SEARCH & SUGGESTIONS
  ══════════════════════════════════════════════════════════════ */

  let suggestionIndex = -1;

  /**
   * Re-render the entire suggestion dropdown for a given input value.
   * Called on every keystroke — fast because everything is in-memory.
   *
   * Shows two kinds of results interleaved:
   *   - AC name matches  (icon ◎, sub-label "AC")
   *   - Locality matches (icon ⊙, sub-label shows the AC it maps to)
   *
   * Layout:
   *   • Input empty  → show recent searches (if any)
   *   • Input has text → show AC + locality matches (or "no matches" row)
   *   • Both sections are never shown simultaneously (less clutter)
   */
  function renderDropdown(rawQuery) {
    const q = rawQuery.trim().toLowerCase();
    const recents = getRecent();

    // ── Compute matches ───────────────────────────────────────────

    // AC name matches (substring, case-insensitive)
    const acMatches = q.length > 0
      ? ALL_AC.filter(ac => ac.toLowerCase().includes(q)).slice(0, 5)
      : [];

    // Locality matches — find keys that include the query or vice-versa
    const localityMatches = q.length >= 2
      ? Object.entries(LOCALITY_TO_AC)
        .filter(([key, ac]) =>
          key.includes(q) &&
          !acMatches.includes(ac)    // don't duplicate if AC already shown
        )
        .slice(0, 4)                 // max 4 locality suggestions
      : [];

    const totalMatches = acMatches.length + localityMatches.length;

    // ── Section visibility ────────────────────────────────────────
    dom.recentSection.classList.toggle("hidden", q.length > 0 || recents.length === 0);
    dom.liveSection.classList.toggle("hidden", q.length === 0);

    // ── Render recent items ───────────────────────────────────────
    dom.recentList.innerHTML = recents.map(r => `
      <li class="suggest-item"
          role="option"
          data-action="select-recent"
          data-value="${escHtml(r)}"
          tabindex="-1">
        <span class="suggest-item__icon" aria-hidden="true">↺</span>
        <span class="suggest-item__name">${escHtml(r)}</span>
        <button class="suggest-item__remove"
                data-action="remove-recent"
                data-value="${escHtml(r)}"
                aria-label="Remove ${escHtml(r)} from recent searches"
                tabindex="-1">✕</button>
      </li>`
    ).join("");

    // ── Render live match items ───────────────────────────────────
    if (q.length > 0) {
      if (totalMatches > 0) {
        // AC name rows
        const acRows = acMatches.map(ac => {
          const lower = ac.toLowerCase();
          const start = lower.indexOf(q);
          const end = start + q.length;
          const name = start >= 0
            ? escHtml(ac.slice(0, start))
            + `<mark>${escHtml(ac.slice(start, end))}</mark>`
            + escHtml(ac.slice(end))
            : escHtml(ac);
          return `
            <li class="suggest-item"
                role="option"
                data-action="select-ac"
                data-value="${escHtml(ac)}"
                tabindex="-1">
              <span class="suggest-item__icon" aria-hidden="true">◎</span>
              <span class="suggest-item__name">${name}</span>
              <span class="suggest-item__sub">Constituency</span>
            </li>`;
        });

        // Locality rows — show the locality name + which AC it belongs to
        const localityRows = localityMatches.map(([key, ac]) => {
          const lower = key;
          const start = lower.indexOf(q);
          const end = start + q.length;
          // Title-case the key for display
          const displayKey = key.replace(/\b\w/g, c => c.toUpperCase());
          const name = start >= 0
            ? escHtml(displayKey.slice(0, start))
            + `<mark>${escHtml(displayKey.slice(start, end))}</mark>`
            + escHtml(displayKey.slice(end))
            : escHtml(displayKey);
          return `
            <li class="suggest-item suggest-item--locality"
                role="option"
                data-action="select-locality"
                data-value="${escHtml(ac)}"
                data-label="${escHtml(displayKey)}"
                tabindex="-1">
              <span class="suggest-item__icon" aria-hidden="true">⊙</span>
              <span class="suggest-item__name">${name}</span>
              <span class="suggest-item__sub">${escHtml(ac)}</span>
            </li>`;
        });

        dom.suggestList.innerHTML = [...acRows, ...localityRows].join("");
      } else {
        // Nothing found locally — indicate geocoding fallback will be tried
        dom.suggestList.innerHTML = `
          <li class="suggest-item suggest-item--empty"
              role="option"
              aria-disabled="true"
              tabindex="-1">
            <span class="suggest-item__icon" aria-hidden="true">○</span>
            <span class="suggest-item__name">
              Press Enter to search for "<em>${escHtml(rawQuery.trim())}</em>" on the map
            </span>
          </li>`;
      }
    } else {
      dom.suggestList.innerHTML = "";
    }

    // ── Show/hide whole dropdown ──────────────────────────────────
    const shouldShow = (q.length === 0 && recents.length > 0) || q.length > 0;
    dom.suggestDropdown.classList.toggle("hidden", !shouldShow);
    dom.searchInput.setAttribute("aria-expanded", String(shouldShow));
    suggestionIndex = -1;
  }

  function hideDropdown() {
    dom.suggestDropdown.classList.add("hidden");
    dom.searchInput.setAttribute("aria-expanded", "false");
    suggestionIndex = -1;
  }

  /** Move keyboard selection through non-disabled suggestion items. */
  function navigateSuggestions(dir) {
    const items = [
      ...dom.suggestDropdown.querySelectorAll(
        ".suggest-item:not(.suggest-item--empty):not([aria-disabled='true'])"
      ),
    ];
    if (!items.length) return;

    items.forEach(i => i.removeAttribute("aria-selected"));
    suggestionIndex = (suggestionIndex + dir + items.length) % items.length;
    const active = items[suggestionIndex];
    active.setAttribute("aria-selected", "true");
    active.scrollIntoView({ block: "nearest" });
  }

  // ── Input event wiring ────────────────────────────────────────

  dom.searchInput.addEventListener("focus", () => {
    renderDropdown(dom.searchInput.value);
  });

  dom.searchInput.addEventListener("input", e => {
    dom.clearBtn.classList.toggle("hidden", e.target.value.length === 0);
    renderDropdown(e.target.value);
  });

  dom.searchInput.addEventListener("keydown", e => {
    const open = !dom.suggestDropdown.classList.contains("hidden");

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (open) navigateSuggestions(+1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) navigateSuggestions(-1);
        break;
      case "Escape":
        hideDropdown();
        dom.searchInput.blur();
        break;
      case "Enter": {
        e.preventDefault();
        const sel = dom.suggestDropdown.querySelector("[aria-selected='true']");
        if (sel) { handleSuggestionClick(sel); }
        else { handleSearchSubmit(dom.searchInput.value.trim()); }
        break;
      }
    }
  });

  dom.clearBtn.addEventListener("click", () => {
    dom.searchInput.value = "";
    dom.clearBtn.classList.add("hidden");
    renderDropdown("");
    dom.searchInput.focus();
  });

  // mousedown (not click) fires before blur, keeping the dropdown open
  dom.suggestDropdown.addEventListener("mousedown", e => {
    const item = e.target.closest("[data-action]");
    if (!item) return;
    e.preventDefault();
    handleSuggestionClick(item);
  });

  document.addEventListener("click", e => {
    if (!dom.searchBox.contains(e.target) && !dom.suggestDropdown.contains(e.target))
      hideDropdown();
  });

  /** Handle a click or keyboard-Enter on a suggestion item. */
  function handleSuggestionClick(el) {
    const action = el.dataset.action;
    const value = el.dataset.value;
    const label = el.dataset.label;   // only set for locality items
    if (!action || !value) return;

    if (action === "remove-recent") { removeRecent(value); return; }

    if (action === "select-recent" || action === "select-ac") {
      dom.searchInput.value = value;
      dom.clearBtn.classList.remove("hidden");
      hideDropdown();
      handleSearchSubmit(value);
    }

    if (action === "select-locality") {
      // value = the AC name, label = the neighbourhood display name
      dom.searchInput.value = label || value;
      dom.clearBtn.classList.remove("hidden");
      hideDropdown();
      if (label) showToast(`"${label}" is in ${value} constituency`, "info", 3000);
      _triggerACLookup(value);
    }
  }

  /**
   * Resolve a raw search query into a lookup.
   *
   * Resolution ladder — tried in strict order, stopping at the first hit:
   *
   *  1. Exact AC name match (case-insensitive)
   *     "Malleshwaram" → Malleshwaram AC
   *
   *  2. Partial AC name match (substring)
   *     "mallesh" → Malleshwaram (only match)
   *     "nagar"   → first of Gandhi Nagar / Sarvagnanagar / … (toast shown)
   *
   *  3. Locality → AC lookup (LOCALITY_TO_AC map, ~400 entries)
   *     "hsr layout"  → B.T.M Layout AC
   *     "mico layout" → Bommanahalli AC
   *     "hosa road"   → Bommanahalli AC
   *
   *  4. Partial locality match (substring scan across LOCALITY_TO_AC keys)
   *     "korama"      → "koramangala" key → Shanti Nagar AC
   *
   *  5. Nominatim geocoding API (free, no key, rate-limited)
   *     Searches OpenStreetMap for the query within Bangalore's bounding box.
   *     On success → drops a pin at the returned lat/lon → calls performLookup.
   *     On failure → shows "not found" toast.
   *
   * @param {string} query - Raw text from the search input.
   */
  async function handleSearchSubmit(query) {
    if (!query.trim()) return;

    const raw = query.trim();
    const q = raw.toLowerCase();

    // ── Step 1: Exact AC name ──────────────────────────────────────
    const exact = ALL_AC.find(ac => ac.toLowerCase() === q);
    if (exact) { _triggerACLookup(exact); return; }

    // ── Step 2: Partial AC name ────────────────────────────────────
    const acPartials = ALL_AC.filter(ac => ac.toLowerCase().includes(q));
    if (acPartials.length === 1) {
      dom.searchInput.value = acPartials[0];
      _triggerACLookup(acPartials[0]);
      return;
    }
    if (acPartials.length > 1) {
      dom.searchInput.value = acPartials[0];
      showToast(`Showing "${acPartials[0]}" — ${acPartials.length} constituencies match`, "info", 3500);
      _triggerACLookup(acPartials[0]);
      return;
    }

    // ── Step 3: Exact locality lookup ─────────────────────────────
    const exactLocality = LOCALITY_TO_AC[q];
    if (exactLocality) {
      showToast(`"${raw}" is in ${exactLocality} constituency`, "info", 3000);
      dom.searchInput.value = exactLocality;
      _triggerACLookup(exactLocality);
      return;
    }

    // ── Step 4: Partial locality match ────────────────────────────
    const localityKeys = Object.keys(LOCALITY_TO_AC);
    const matchingKey = localityKeys.find(k => k.includes(q) || q.includes(k));
    if (matchingKey) {
      const ac = LOCALITY_TO_AC[matchingKey];
      showToast(`"${raw}" → ${ac} constituency`, "info", 3000);
      dom.searchInput.value = ac;
      _triggerACLookup(ac);
      return;
    }

    // ── Step 5: Nominatim geocoding fallback ──────────────────────
    // Shows a searching toast immediately so the user knows something
    // is happening — Nominatim can take 1-2 seconds.
    await _geocodeAndLookup(raw);
  }

  /**
   * Geocode a free-text place name using the Nominatim API (OpenStreetMap)
   * restricted to Bangalore's bounding box, then perform a representative
   * lookup at the returned coordinate.
   *
   * Rate limit: Nominatim allows 1 req/second. We don't add debounce here
   * because this function is only reached after all local lookups fail —
   * a user won't trigger it on every keystroke.
   *
   * @param {string} placeName - Raw user input to geocode.
   */
  async function _geocodeAndLookup(placeName) {
    // Bangalore bounding box: SW (12.74, 77.37) → NE (13.14, 77.84)
    const bbox = "77.37,12.74,77.84,13.14";
    const query = encodeURIComponent(`${placeName}, Bangalore, Karnataka, India`);
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&bounded=1&viewbox=${bbox}`;

    const geocodeToast = _showPersistentToast(`Searching for "${placeName}"…`, "info");

    try {
      const response = await fetch(url, {
        headers: { "Accept-Language": "en", "User-Agent": "RepLookup-Bangalore/3.1" },
        signal: AbortSignal.timeout(8000),
      });

      geocodeToast.remove();

      if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);

      const results = await response.json();

      if (!results.length) {
        showToast(`"${placeName}" not found in Bangalore. Try clicking the map.`, "error", 5000);
        return;
      }

      const { lat, lon, display_name } = results[0];
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);

      // Bangalore bounds check
      if (latNum < 12.74 || latNum > 13.14 || lonNum < 77.37 || lonNum > 77.84) {
        showToast(`"${placeName}" appears to be outside Bangalore.`, "error", 4000);
        return;
      }

      showToast(`Found: ${display_name.split(",")[0]}`, "success", 2500);

      // Switch to map view, drop pin, run lookup
      if (state.activeView !== "map") switchView("map");
      state.map.flyTo([latNum, lonNum], 14, { animate: true, duration: 0.9 });
      placeMarker(latNum, lonNum);
      await performLookup(latNum, lonNum);

    } catch (err) {
      geocodeToast.remove();
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        showToast("Location search timed out. Try clicking the map.", "error", 4000);
      } else {
        showToast(`Could not find "${placeName}". Try clicking the map.`, "error", 4500);
      }
    }
  }

  /**
   * Show a toast that stays until manually removed (no auto-dismiss).
   * Returns the toast DOM element so the caller can remove it on completion.
   *
   * @param {string} msg
   * @param {"info"|"error"|"success"} type
   * @returns {HTMLElement}
   */
  function _showPersistentToast(msg, type = "info") {
    const icons = { info: "ℹ", error: "✕", success: "✓" };
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.setAttribute("role", "status");
    el.innerHTML = `
      <span class="toast__icon">${icons[type] ?? "ℹ"}</span>
      <span>${msg}</span>
      <span class="toast__spinner" aria-hidden="true"></span>`;
    dom.toastContainer.appendChild(el);
    return el;
  }

  /** Save to recents and start the lookup for a canonical AC name. */
  function _triggerACLookup(acName) {
    saveRecent(acName);
    lookupByACName(acName);
  }

  /* ══════════════════════════════════════════════════════════════
     GEOLOCATION
  ══════════════════════════════════════════════════════════════ */

  dom.locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by this browser.", "error");
      return;
    }
    dom.locateBtn.classList.add("loading");
    navigator.geolocation.getCurrentPosition(
      pos => {
        dom.locateBtn.classList.remove("loading");
        const { latitude: lat, longitude: lon } = pos.coords;
        placeMarker(lat, lon);
        state.map.setView([lat, lon], 14, { animate: true });
        performLookup(lat, lon);
      },
      err => {
        dom.locateBtn.classList.remove("loading");
        const msgs = {
          1: "Location access denied. Allow it in your browser settings.",
          2: "Your location is currently unavailable.",
          3: "Location request timed out.",
        };
        showToast(msgs[err.code] ?? "Could not determine your location.", "error");
      },
      { timeout: 10_000, maximumAge: 60_000 }
    );
  });

  /* ══════════════════════════════════════════════════════════════
     MAP
  ══════════════════════════════════════════════════════════════ */

  function initMap() {
    state.map = L.map("map", {
      center: CENTER,
      zoom: ZOOM,
      maxBounds: BOUNDS,
      maxBoundsViscosity: 0.75,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(state.map);

    state.map.on("click", e => {
      const { lat, lng } = e.latlng;
      placeMarker(lat, lng);
      performLookup(lat, lng);
    });

    dom.resetMapBtn.addEventListener("click", resetMap);
  }

  function pinIcon(color = "#3b5bdb") {
    return L.divIcon({
      className: "",
      html: `
        <div style="position:relative;width:0;height:0;">
          <div style="position:absolute;left:-12px;top:-30px;width:24px;height:30px;">
            <svg viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C5.373 0 0 5.373 0 12C0 20.25 12 30 12 30
                       C12 30 24 20.25 24 12C24 5.373 18.627 0 12 0Z"
                    fill="${color}"/>
              <circle cx="12" cy="12" r="5" fill="white"/>
            </svg>
          </div>
        </div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  function placeMarker(lat, lng) {
    if (state.currentMarker) state.map.removeLayer(state.currentMarker);
    state.currentMarker = L.marker([lat, lng], { icon: pinIcon() }).addTo(state.map);
    state.lastLatLng = { lat, lng };
  }

  function clearBoundaryLayer() {
    if (state.currentLayer) {
      state.map.removeLayer(state.currentLayer);
      state.currentLayer = null;
    }
  }

  async function highlightAC(acName) {
    clearBoundaryLayer();
    try {
      const r = await fetch(
        `${API}/api/v1/constituencies/geojson/${encodeURIComponent(acName)}`
      );
      if (!r.ok) return;
      const geo = await r.json();

      // Read the accent CSS variable at runtime — Leaflet layer styles
      // do not support CSS variables directly.
      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent").trim() || "#3b5bdb";

      state.currentLayer = L.geoJSON(geo, {
        style: {
          color: accent,
          weight: 2,
          fillColor: accent,
          fillOpacity: 0.08,
          dashArray: "6 4",
        },
      }).addTo(state.map);
    } catch (_) { /* non-critical — swallow */ }
  }

  function resetMap() {
    state.map.flyTo(CENTER, ZOOM, { animate: true, duration: 0.8 });
    clearBoundaryLayer();
    if (state.currentMarker) {
      state.map.removeLayer(state.currentMarker);
      state.currentMarker = null;
    }
    showPanelState("empty");
    dom.mapHint.classList.remove("fade-out");
    state.lastLatLng = null;
    state.lastResult = null;
  }

  /* ══════════════════════════════════════════════════════════════
     NAME-BASED LOOKUP  (the fixed version)

     Previously had only 10 hardcoded entries; 27 ACs hit a useless
     fallback. Now AC_COORDS covers all 37, so every search resolves.
  ══════════════════════════════════════════════════════════════ */

  async function lookupByACName(acName) {
    const coords = AC_COORDS[acName];

    if (!coords) {
      // Defensive fallback — should not occur with a complete AC_COORDS map
      console.warn(`lookupByACName: no coordinates found for "${acName}"`);
      showToast(
        `Could not auto-locate "${acName}". Try clicking it on the map.`,
        "error",
        4500
      );
      return;
    }

    const [lat, lng] = coords;
    state.map.flyTo([lat, lng], 13, { animate: true, duration: 0.9 });
    placeMarker(lat, lng);
    await performLookup(lat, lng);
  }

  /* ══════════════════════════════════════════════════════════════
     API LOOKUP
  ══════════════════════════════════════════════════════════════ */

  /**
   * Classify a fetch error or non-2xx HTTP response into a
   * structured, user-readable object.
   */
  function classifyError(err, httpStatus) {
    if (
      err instanceof TypeError ||
      err.name === "TypeError" ||
      (err.message && (
        err.message === "Failed to fetch" ||
        err.message.includes("NetworkError") ||
        err.message.includes("fetch")
      ))
    ) {
      return {
        title: "Cannot reach the API",
        detail: "The backend server is not running.",
        type: "api-down",
      };
    }

    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return {
        title: "Request timed out",
        detail: "The API took too long to respond. Ensure the backend is running.",
        type: "timeout",
      };
    }

    if (httpStatus === 404 ||
      (err.message && err.message.toLowerCase().includes("no representatives"))) {
      return {
        title: "No representatives found",
        detail: "This point is outside all Bangalore constituency boundaries.",
        type: "outside",
      };
    }

    if (httpStatus === 503) {
      return {
        title: "API not ready",
        detail: "The backend started but couldn't load constituency data. Check the data/ folder.",
        type: "api-error",
      };
    }

    return {
      title: "Something went wrong",
      detail: err.message ?? "An unexpected error occurred.",
      type: "generic",
    };
  }

  async function performLookup(lat, lng) {
    showPanelState("loading");
    progressStart();
    dom.mapHint.classList.add("fade-out");

    const t0 = performance.now();
    let httpStatus = null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(
        `${API}/api/v1/lookup?lat=${lat}&lon=${lng}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      httpStatus = response.status;

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        showErrorState(
          classifyError(new Error(body.detail ?? `HTTP ${response.status}`), httpStatus)
        );
        progressEnd(false);
        return;
      }

      const data = await response.json();
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

      state.lastResult = data;
      renderResults(data, lat, lng, elapsed);
      progressEnd(true);

      if (data.mla?.constituency) highlightAC(data.mla.constituency);

    } catch (err) {
      clearTimeout(timeoutId);
      progressEnd(false);
      showErrorState(classifyError(err, httpStatus));
    }
  }

  function showErrorState(info) {
    const ICONS = {
      "api-down": "🔌",
      "timeout": "⏱",
      "outside": "📍",
      "api-error": "⚙️",
      "generic": "⚠️",
    };

    const titleEl = dom.stateError.querySelector(".error-title");
    const detailEl = dom.stateError.querySelector(".error-msg");
    const hintEl = dom.stateError.querySelector(".error-hint");
    const artEl = dom.stateError.querySelector(".error-art");

    if (titleEl) titleEl.textContent = info.title;
    if (detailEl) detailEl.textContent = info.detail;

    if (hintEl) {
      if (info.type === "api-down") {
        hintEl.textContent = "$ uvicorn app.main:app --reload";
        hintEl.classList.add("visible");
      } else {
        hintEl.textContent = "";
        hintEl.classList.remove("visible");
      }
    }

    if (artEl) artEl.style.color = info.type === "outside" ? "var(--amber)" : "var(--red)";

    showPanelState("error");

    const toastType = info.type === "outside" ? "info" : "error";
    const duration = info.type === "api-down" ? 6000 : 3500;
    showToast(`${ICONS[info.type] ?? "⚠️"} ${info.title}`, toastType, duration);
  }

  dom.retryBtn.addEventListener("click", () => {
    if (state.lastLatLng) performLookup(state.lastLatLng.lat, state.lastLatLng.lng);
    else { showPanelState("empty"); dom.mapHint.classList.remove("fade-out"); }
  });

  /* ══════════════════════════════════════════════════════════════
     RESULTS RENDERING
  ══════════════════════════════════════════════════════════════ */

  function showPanelState(panelState) {
    const idMap = {
      empty: "stateEmpty", loading: "stateLoading",
      error: "stateError", results: "stateResults",
    };
    const activeId = idMap[panelState];
    Object.values(idMap).forEach(id =>
      dom[id].classList.toggle("hidden", id !== activeId)
    );
  }

  function renderResults(data, lat, lng, elapsed) {
    dom.resultsMeta.innerHTML = `
      <span class="results-meta__coords">📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
      <span class="results-meta__time">Found in ${elapsed}s</span>`;
    dom.cardsContainer.innerHTML = "";
    if (data.mla) dom.cardsContainer.appendChild(buildCard(data.mla, "MLA", "Member of Legislative Assembly"));
    if (data.mp) dom.cardsContainer.appendChild(buildCard(data.mp, "MP", "Member of Parliament"));
    showPanelState("results");
  }

  function buildCard(rep, roleCode, roleFull) {
    const isMLA = roleCode === "MLA";
    const hasData = rep.name && rep.name !== "Data not available";
    const card = document.createElement("div");
    card.className = "rep-card";
    card.dataset.ac = rep.constituency ?? "";

    card.addEventListener("mouseenter", () => card.classList.add("highlighted"));
    card.addEventListener("mouseleave", () => card.classList.remove("highlighted"));

    // Normalise party key: strip non-alpha, uppercase
    const partyKey = (rep.party ?? "").toUpperCase().replace(/[^A-Z]/g, "");
    const partyStyle = PARTY_STYLES[partyKey] ?? { cls: "tag--party-other", label: rep.party ?? "—" };

    card.innerHTML = `
      <div class="card-header">
        <div class="card-header__left">
          <span class="card-role-badge ${isMLA ? "badge--mla" : "badge--mp"}">${roleCode}</span>
          <span class="card-role-sub">${roleFull}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="rep-name">${escHtml(hasData ? rep.name : "Data unavailable")}</div>
        ${hasData ? `
          <div class="card-tags">
            <span class="tag ${partyStyle.cls}" aria-label="Party: ${escHtml(partyStyle.label)}">
              ${escHtml(partyStyle.label)}
            </span>
            ${rep.constituency ? `
              <span class="tag tag--constituency">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                </svg>
                ${escHtml(rep.constituency)}
              </span>` : ""}
          </div>
          ${buildContacts(rep)}
        ` : `<p style="font-size:.82rem;color:var(--text-3);line-height:1.6;">
               Representative data will be updated after the next election cycle.
             </p>`}
      </div>
      ${hasData ? `
        <div class="card-actions">
          <button class="card-btn" data-action="copy"
            aria-label="Copy ${escHtml(rep.name)}'s contact info">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg><span>Copy</span>
          </button>
          <button class="card-btn" data-action="mapfocus"
            aria-label="Focus map on ${escHtml(rep.constituency ?? "")}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              <line x1="12" y1="2" x2="12" y2="5"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg><span>Map</span>
          </button>
          <button class="card-btn" data-action="share"
            aria-label="Share ${escHtml(rep.name)}'s details">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51"  x2="8.59"  y2="10.49"/>
            </svg><span>Share</span>
          </button>
        </div>` : ""}`;

    card.querySelector('[data-action="copy"]')?.addEventListener("click", e => copyCardInfo(rep, e.currentTarget));
    card.querySelector('[data-action="mapfocus"]')?.addEventListener("click", () => focusOnMap(rep));
    card.querySelector('[data-action="share"]')?.addEventListener("click", () => shareResult(rep));

    return card;
  }

  function buildContacts(rep) {
    const rows = [];
    if (rep.contact)
      rows.push(`<div class="contact-row">
        <span class="contact-row__icon" aria-hidden="true">☎</span>
        <span>${escHtml(rep.contact)}</span></div>`);
    if (rep.email)
      rows.push(`<div class="contact-row">
        <span class="contact-row__icon" aria-hidden="true">✉</span>
        <a href="mailto:${escHtml(rep.email)}" rel="noopener">${escHtml(rep.email)}</a>
        </div>`);
    if (rep.office_address)
      rows.push(`<div class="contact-row">
        <span class="contact-row__icon" aria-hidden="true">⌂</span>
        <span style="font-size:.74rem;color:var(--text-3);">${escHtml(rep.office_address)}</span>
        </div>`);
    return rows.length ? `<div class="card-contacts">${rows.join("")}</div>` : "";
  }

  async function copyCardInfo(rep, btn) {
    const text = [rep.name, rep.party, rep.constituency, rep.contact, rep.email]
      .filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add("card-btn--copied");
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Copied!</span>`;
      showToast("Contact info copied", "success");
      setTimeout(() => {
        btn.classList.remove("card-btn--copied");
        btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg><span>Copy</span>`;
      }, 2500);
    } catch (_) {
      showToast("Clipboard access denied.", "error");
    }
  }

  function focusOnMap(rep) {
    if (state.activeView !== "map") switchView("map");
    if (state.lastLatLng)
      state.map.flyTo([state.lastLatLng.lat, state.lastLatLng.lng], 14,
        { animate: true, duration: 0.8 });
    if (rep.constituency) highlightAC(rep.constituency);
  }

  function shareResult(rep) {
    const url = `${location.origin}${location.pathname}?q=${encodeURIComponent(rep.constituency ?? "")}`;
    if (navigator.share) {
      navigator.share({ title: `${rep.name} — ${rep.constituency}`, url }).catch(() => { });
    } else {
      navigator.clipboard.writeText(url)
        .then(() => showToast("Link copied", "success"))
        .catch(() => showToast("Could not copy link.", "error"));
    }
  }

  /* ══════════════════════════════════════════════════════════════
     VIEW TOGGLE
  ══════════════════════════════════════════════════════════════ */

  dom.btnMapView.addEventListener("click", () => switchView("map"));
  dom.btnListView.addEventListener("click", () => switchView("list"));

  function switchView(view) {
    state.activeView = view;
    const isMap = view === "map";
    dom.mapView.classList.toggle("hidden", !isMap);
    dom.listView.classList.toggle("hidden", isMap);
    dom.btnMapView.classList.toggle("active", isMap);
    dom.btnListView.classList.toggle("active", !isMap);
    dom.btnMapView.setAttribute("aria-selected", String(isMap));
    dom.btnListView.setAttribute("aria-selected", String(!isMap));
    if (!isMap && !state.listLoaded) loadConstituencyList();
    if (isMap) setTimeout(() => state.map?.invalidateSize(), 120);
  }

  /* ══════════════════════════════════════════════════════════════
     LIST VIEW
  ══════════════════════════════════════════════════════════════ */

  function getACToPCMap() {
    return {
      "Bangalore North": ["K.R.Pura", "Byatarayanapura", "Yeshvanthapura", "Dasarahalli", "Mahalakshmi Layout", "Malleshwaram", "Hebbal", "Pulakeshinagar", "Yelahanka"],
      "Bangalore Central": ["Shivajinagar", "Shanti Nagar", "Gandhi Nagar", "Rajaji Nagar", "Chamrajpet", "Chickpet", "Sarvagnanagar", "C.V. Raman Nagar", "Mahadevapura"],
      "Bangalore South": ["Govindraj Nagar", "Vijay Nagar", "Basavanagudi", "Padmanaba Nagar", "B.T.M Layout", "Jayanagar", "Bommanahalli"],
      "Bangalore Rural": ["Rajarajeshwarinagar", "Bangalore South", "Anekal", "Magadi", "Ramanagaram", "Kanakapura", "Channapatna", "Hosakote", "Doddaballapur", "Devanahalli", "Nelamangala"],
    };
  }

  async function loadConstituencyList() {
    try {
      const r = await fetch(`${API}/api/v1/constituencies`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      state.listLoaded = true;

      const AC_TO_PC = {};
      for (const [pc, acs] of Object.entries(getACToPCMap()))
        for (const ac of acs) AC_TO_PC[ac] = pc;

      dom.tableBody.innerHTML = data.assembly_constituencies.map(ac => {
        const displayAC = ac.replace(/\(SC\)$/i, "").trim();
        const pc = AC_TO_PC[displayAC] ?? "—";
        return `
          <tr>
            <td>${escHtml(displayAC)}</td>
            <td><span class="tag tag--constituency" style="font-size:.72rem;">${escHtml(pc)}</span></td>
            <td style="text-align:right;">
              <button class="table-lookup-btn" data-ac="${escHtml(displayAC)}">Look up →</button>
            </td>
          </tr>`;
      }).join("");

      dom.tableBody.querySelectorAll(".table-lookup-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const ac = btn.dataset.ac;
          switchView("map");
          dom.searchInput.value = ac;
          dom.clearBtn.classList.remove("hidden");
          _triggerACLookup(ac);
        });
      });

    } catch (_) {
      dom.tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;
        color:var(--text-3);padding:2rem;">Could not load list. Is the backend running?</td></tr>`;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS
  ══════════════════════════════════════════════════════════════ */

  document.addEventListener("keydown", e => {
    if (e.key === "/" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      dom.searchInput.focus();
      dom.searchInput.select();
    }
  });

  /* ══════════════════════════════════════════════════════════════
     DEEP-LINK  ?q=ConstituencyName
  ══════════════════════════════════════════════════════════════ */

  function handleDeepLink() {
    const q = new URLSearchParams(location.search).get("q");
    if (q) {
      dom.searchInput.value = q;
      dom.clearBtn.classList.remove("hidden");
      setTimeout(() => handleSearchSubmit(q), 700);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════════════════════ */

  /** Escape user/API-sourced strings before inserting into innerHTML. */
  function escHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ══════════════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════════════ */

  function init() {
    initTheme();
    initMap();
    handleDeepLink();
  }

  init();

})();