// ======================================================
// FIREBASE — real-time sync across every device
// ======================================================
const firebaseConfig={
  apiKey:"AIzaSyD3vlzCrAMJ6F2j1IPn9TRW8CiOJso0iGc",
  authDomain:"monalisa-stock-erp.firebaseapp.com",
  databaseURL:"https://monalisa-stock-erp-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:"monalisa-stock-erp",
  storageBucket:"monalisa-stock-erp.firebasestorage.app",
  messagingSenderId:"982784559239",
  appId:"1:982784559239:web:9710d243dc24b39f211022"
};
let fbApp=null, fbDb=null, fbReady=false;
let fbDevices=null, fbAllocations=null, fbCustomers=null, fbAuditLog=null;

function setSyncStatus(state){
  const icon=document.getElementById('syncIcon');
  const txt=document.getElementById('syncStatus');
  const pill=document.getElementById('syncPill');
  if(!icon||!txt||!pill)return;
  if(state==='connecting'){
    icon.className='fas fa-cloud-arrow-up';txt.textContent='Connecting...';
    pill.style.background='rgba(245,166,35,.08)';pill.style.borderColor='rgba(245,166,35,.18)';pill.style.color='var(--amber)';
  }else if(state==='online'){
    icon.className='fas fa-cloud';txt.textContent='Synced live';
    pill.style.background='rgba(0,200,150,.08)';pill.style.borderColor='rgba(0,200,150,.18)';pill.style.color='var(--green)';
  }else if(state==='offline'){
    icon.className='fas fa-cloud-slash';txt.textContent='Offline — local only';
    pill.style.background='rgba(232,69,69,.08)';pill.style.borderColor='rgba(232,69,69,.18)';pill.style.color='var(--red)';
  }
}

function initFirebase(){
  try{
    setSyncStatus('connecting');
    fbApp=firebase.initializeApp(firebaseConfig);
    fbDb=firebase.database();
    fbAuth=firebase.auth();

    // connection state
    fbDb.ref('.info/connected').on('value',snap=>{
      fbReady=!!snap.val();
      setSyncStatus(fbReady?'online':'offline');
    });

    setTimeout(()=>{if(!fbReady)setSyncStatus('offline')},4000);
  }catch(e){
    console.error('Firebase init failed',e);
    setSyncStatus('offline');
  }
}

// ======================================================
// COMPANY-SCOPED DATA CONNECTIONS
// ======================================================
// IMPORTANT: devices, customers, allocations, and the audit log all
// live under their own company's path in the database — e.g.
// devices/{companyId}/{imei} — to match the security rules exactly,
// which require this exact nesting for read/write access. This
// function connects all four AFTER login, once we actually know which
// company the signed-in person belongs to. Calling this is what
// makes every later read/write actually reach the database instead of
// being silently rejected by rules that expect this shape.
function connectCompanyData(){
  if(!fbDb||!currentUser||!currentUser.companyId){
    console.warn('connectCompanyData called without a companyId — skipping data connections');
    return;
  }
  const cid=currentUser.companyId;
  fbDevices=fbDb.ref('devices/'+cid);
  fbCustomers=fbDb.ref('customers/'+cid);
  fbAllocations=fbDb.ref('allocations/'+cid);
  fbAuditLog=fbDb.ref('auditLog/'+cid);

  // seed data only if this company's own database section is empty —
  // every company starts genuinely empty, no shared demo data
  fbDevices.once('value').then(snap=>{
    if(!snap.exists()){
      fbDevices.set({});
      devices.length=0;
    }
  });
  fbCustomers.once('value').then(snap=>{
    if(!snap.exists()){
      fbCustomers.set({});
      customers.length=0;
    }
  });

  fbDevices.on('value',snap=>{
    const val=snap.val();
    devices.length=0;
    if(val)Object.values(val).forEach(d=>devices.push(d));
    if(document.getElementById('pg-inventory')?.classList.contains('on')){filterInv()}
    if(document.getElementById('pg-allocation')?.classList.contains('on')){renderPendingAllocations();renderRecentMovements();}
    if(document.getElementById('pg-dashboard')?.classList.contains('on')){renderDashboard()}
    if(document.getElementById('pg-recovery')?.classList.contains('on')){renderRecoveryQueue()}
  });
  fbCustomers.on('value',snap=>{
    const val=snap.val();
    customers.length=0;
    if(val)Object.keys(val).forEach(key=>customers.push({...val[key],_key:key}));
    if(document.getElementById('pg-customers')?.classList.contains('on')){filterCustomers()}
  });
  fbAllocations.on('value',snap=>{
    const val=snap.val()||{};
    allAllocations=Object.keys(val).map(key=>({id:key,...val[key]}));
    if(currentUser){
      renderPendingAllocations();
      renderRecentMovements();
    }
  });
}

function fbLogAction(action,details){
  if(!fbAuditLog||!fbReady)return;
  fbAuditLog.push({
    time:new Date().toLocaleTimeString(),
    date:new Date().toLocaleDateString(),
    user:currentUser?currentUser.name:'Unknown',
    role:currentUser?currentUser.role:'-',
    action,details,
    ts:Date.now()
  });
}

function fbUpdateDevice(imei,changes){
  if(fbDevices&&fbReady){
    fbDevices.child(imei).update(changes);
  }else{
    const d=devices.find(x=>x.imei===imei);
    if(d)Object.assign(d,changes);
  }
}
function fbAddDevice(device){
  device.companyId=currentUser?currentUser.companyId:null;
  if(fbDevices&&fbReady){
    fbDevices.child(device.imei).set(device);
  }else{
    devices.push(device);

  }
}
// ======================================================
// COMPANY SETTINGS — commission rates, brands, contact info
// ======================================================
let companySettings={};
let companyBrands={};

// ======================================================
// WAREHOUSES — region-scoped for Regional Managers
// ======================================================
let companyWarehouses={};

function loadWarehousesPage(){
  if(!currentUser||!currentUser.companyId)return;
  const canAdd=['ceo','admin'].includes(currentUser.role);
  document.getElementById('addWarehouseBtn').style.display=canAdd?'inline-flex':'none';

  const scopeBanner=document.getElementById('warehouseScopeBanner');
  const scopeText=document.getElementById('warehouseScopeText');
  if(currentUser.role==='regionalmanager'){
    scopeBanner.style.display='flex';
    scopeText.textContent='You only see warehouses in your assigned region: '+(currentUser.assignedRegion||'not yet set — contact your CEO');
  }else{
    scopeBanner.style.display='none';
  }

  fbDb.ref('companies/'+currentUser.companyId+'/warehouses').once('value').then(snap=>{
    companyWarehouses=snap.val()||{};
    renderWarehouses();
  });

  populateWarehouseManagerSelect();
}

function renderWarehouses(){
  const wrap=document.getElementById('warehousesList');
  if(!wrap)return;
  let keys=Object.keys(companyWarehouses);
  if(currentUser.role==='regionalmanager'){
    keys=keys.filter(k=>companyWarehouses[k].region===currentUser.assignedRegion);
  }
  if(!keys.length){
    wrap.innerHTML='<div class="card"><div class="xs muted" style="text-align:center;padding:16px 0">No warehouses added yet.</div></div>';
    return;
  }
  wrap.innerHTML=keys.map(k=>{
    const w=companyWarehouses[k];
    const managerName=usersList.find(u=>u.uid===w.managerUid)?.name||'Unassigned';
    const unitsHeld=devices.filter(d=>d.warehouseKey===k&&d.status!=='sold').length;
    return `<div class="card">
      <div class="between mb10"><span class="bold">${w.name}</span><span class="badge b-g">${w.region||'—'}</span></div>
      <div class="xs muted mb4">${w.location||'—'}</div><div class="xs muted mb16">Manager: ${managerName}</div>
      <div class="g2" style="gap:8px">
        <div style="background:var(--card2);padding:10px;border-radius:8px;text-align:center"><div class="bold green lg">${unitsHeld}</div><div class="xs muted">Units</div></div>
      </div>
    </div>`;
  }).join('');
}

function populateWarehouseManagerSelect(){
  const sel=document.getElementById('whManagerUid');
  if(!sel)return;
  const managers=getVisibleUsers().filter(u=>u.role==='manager');
  sel.innerHTML='<option value="">No manager assigned</option>'+managers.map(m=>`<option value="${m.uid}">${m.name}${m.teamName?' — '+m.teamName:''}</option>`).join('');
}

function doAddWarehouse(){
  const name=document.getElementById('whName').value.trim();
  const location=document.getElementById('whLocation').value.trim();
  const region=document.getElementById('whRegion').value;
  const managerUid=document.getElementById('whManagerUid').value||null;
  if(!name||!region){
    toast('Please enter a name and select a region','var(--red)');
    return;
  }
  const key='wh_'+Date.now();
  fbDb.ref('companies/'+currentUser.companyId+'/warehouses/'+key).set({
    name,location:location||'—',region,managerUid,createdAt:Date.now(),createdBy:currentUser.uid
  }).then(()=>{
    companyWarehouses[key]={name,location,region,managerUid};
    renderWarehouses();
    closeM('mAddWarehouse');
    toast('Warehouse added');
    fbLogAction('WAREHOUSE_ADDED',currentUser.name+' added warehouse '+name+' ('+region+')');
  }).catch(()=>toast('Could not save — check your permissions','var(--red)'));
}

function loadCompanySettingsPage(){
  if(!currentUser||!currentUser.companyId)return;
  const canEdit=currentUser.role==='ceo'||currentUser.role==='admin';
  document.getElementById('settingsPermBanner').style.display=canEdit?'none':'flex';
  ['saveRolesBtn','addBrandBtn','saveContactBtn','saveAgeFieldBtn','saveAgeShopBtn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=canEdit?'inline-flex':'none';
  });

  loadAgingPolicy().then(()=>{
    document.getElementById('ageGoodField').value=agingPolicy.field.good;
    document.getElementById('ageWarnField').value=agingPolicy.field.warn;
    document.getElementById('ageGoodShop').value=agingPolicy.shop.good;
    document.getElementById('ageWarnShop').value=agingPolicy.shop.warn;
  });

  fbDb.ref('companies/'+currentUser.companyId+'/profile').once('value').then(snap=>{
    const p=snap.val()||{};
    document.getElementById('setCompanyName').value=p.businessName||'—';
    document.getElementById('setCompanyAddress').value=p.businessAddress||'—';
    document.getElementById('setCompanyEmail').value=p.businessEmail||'—';
  });

  fbDb.ref('companies/'+currentUser.companyId+'/settings').once('value').then(snap=>{
    companySettings=snap.val()||{};
    const rates=companySettings.commissionRates||{};
    document.getElementById('rateAgent').value=rates.agent??'';
    document.getElementById('rateShopowner').value=rates.shopowner??'';
    document.getElementById('rateTeamleaderCum').value=rates.teamleaderCumulative??'';
    document.getElementById('rateManagerCum').value=rates.managerCumulative??'';
    const bonus=companySettings.bonusCommission||{enabled:false,agent:0,leader:0};
    document.getElementById('toggleBonusEnabled').classList.toggle('on',!!bonus.enabled);
    document.getElementById('bonusAmountFields').style.display=bonus.enabled?'block':'none';
    document.getElementById('bonusStatusBadge').textContent=bonus.enabled?'Enabled':'Optional — off';
    document.getElementById('bonusStatusBadge').className=bonus.enabled?'badge b-g':'badge';
    document.getElementById('bonusAgent').value=bonus.agent||'';
    document.getElementById('bonusLeader').value=bonus.leader||'';
    document.getElementById('setWhatsapp').value=companySettings.whatsappNumber||'';
    document.getElementById('setSupportEmail').value=companySettings.supportEmail||'';
  });

  fbDb.ref('companies/'+currentUser.companyId+'/brands').once('value').then(snap=>{
    companyBrands=snap.val()||{};
    renderCompanyBrands();
  });
}

function toggleBonusEnabled(el){
  el.classList.toggle('on');
  document.getElementById('bonusAmountFields').style.display=el.classList.contains('on')?'block':'none';
}

function saveCommissionRates(){
  if(!currentUser.companyId)return;
  const rates={
    agent:parseInt(document.getElementById('rateAgent').value)||0,
    shopowner:parseInt(document.getElementById('rateShopowner').value)||0,
    teamleaderCumulative:parseInt(document.getElementById('rateTeamleaderCum').value)||0,
    managerCumulative:parseInt(document.getElementById('rateManagerCum').value)||0
  };
  const bonus={
    enabled:document.getElementById('toggleBonusEnabled').classList.contains('on'),
    agent:parseInt(document.getElementById('bonusAgent').value)||0,
    leader:parseInt(document.getElementById('bonusLeader').value)||0
  };
  Promise.all([
    fbDb.ref('companies/'+currentUser.companyId+'/settings/commissionRates').set(rates),
    fbDb.ref('companies/'+currentUser.companyId+'/settings/bonusCommission').set(bonus)
  ]).then(()=>{
    companySettings.commissionRates=rates;
    companySettings.bonusCommission=bonus;
    toast('Commission settings saved');
    fbLogAction('SETTINGS_UPDATED',currentUser.name+' updated commission settings');
  }).catch(()=>toast('Could not save — check your permissions','var(--red)'));
}

function saveCompanyContact(){
  if(!currentUser.companyId)return;
  const whatsapp=document.getElementById('setWhatsapp').value.trim();
  const email=document.getElementById('setSupportEmail').value.trim();
  if(!whatsapp||!email){
    toast('Please fill in both a WhatsApp number and an email','var(--red)');
    return;
  }
  fbDb.ref('companies/'+currentUser.companyId+'/settings').update({
    whatsappNumber:whatsapp,supportEmail:email
  }).then(()=>{
    toast('Support contact saved. Your team will now see these instead of placeholder details.');
    fbLogAction('SETTINGS_UPDATED',currentUser.name+' updated company support contact');
  }).catch(()=>toast('Could not save — check your permissions','var(--red)'));
}

function renderCompanyBrands(){
  const wrap=document.getElementById('companyBrandsList');
  const commWrap=document.getElementById('brandCommissionList');
  const names=Object.keys(companyBrands);
  if(!names.length){
    wrap.innerHTML='<div class="xs muted">No brands added yet.</div>';
    commWrap.innerHTML='<div class="xs muted">Add a brand first under "Brands you sell" below.</div>';
    return;
  }
  const canEdit=currentUser.role==='ceo'||currentUser.role==='admin';
  wrap.innerHTML=names.map(key=>`<span class="chip" style="font-size:12px;padding:5px 10px">${companyBrands[key].name}${canEdit?` <i class="fas fa-times" style="cursor:pointer;margin-left:5px;color:var(--red)" onclick="removeCompanyBrand('${key}')"></i>`:''}</span>`).join('');
  commWrap.innerHTML=names.map(key=>{
    const b=companyBrands[key];
    return `<div class="row" style="justify-content:space-between">
      <span class="sm bold" style="min-width:100px">${b.name}</span>
      <input class="inp" type="number" step="0.1" placeholder="Use role % above" style="max-width:160px" value="${b.fixedCommission??''}" onchange="setBrandCommission('${key}',this.value)" ${canEdit?'':'disabled'}>
      <span class="xs muted">UGX or % — your call</span>
    </div>`;
  }).join('');
}

function addCompanyBrand(){
  if(!currentUser.companyId)return;
  const name=document.getElementById('newBrandName').value.trim();
  if(!name){toast('Type a brand name first','var(--red)');return}
  const key='b_'+Date.now();
  fbDb.ref('companies/'+currentUser.companyId+'/brands/'+key).set({name,addedAt:Date.now()}).then(()=>{
    companyBrands[key]={name,addedAt:Date.now()};
    document.getElementById('newBrandName').value='';
    renderCompanyBrands();
    toast(name+' added to your brand list');
    fbLogAction('BRAND_ADDED',currentUser.name+' added brand '+name);
  }).catch(()=>toast('Could not save — check your permissions','var(--red)'));
}
function removeCompanyBrand(key){
  if(!currentUser.companyId)return;
  if(!confirm('Remove this brand from your list?'))return;
  fbDb.ref('companies/'+currentUser.companyId+'/brands/'+key).remove().then(()=>{
    delete companyBrands[key];
    renderCompanyBrands();
    toast('Brand removed');
  });
}
function setBrandCommission(key,value){
  if(!currentUser.companyId)return;
  fbDb.ref('companies/'+currentUser.companyId+'/brands/'+key+'/fixedCommission').set(value===''?null:parseFloat(value));
}

function fbAddCustomer(customer){
  if(fbCustomers&&fbReady){
    fbCustomers.push(customer);
  }else{
    customers.push(customer);
  }
}

// ======================================================
// USER DIRECTORY — defines the real hierarchy
// ======================================================
// ======================================================
// ROLE PERMISSIONS — the rules stay the same, but WHO has
// which role now comes from the database (set by the CEO),
// not from a hardcoded list in this file.
// ======================================================
const perms={
  superadmin:{canCreateUsers:false,canDeleteUsers:false,allocateTo:[],canAddStock:false,addStockNote:'The Super Administrator oversees companies on the platform and does not manage any single company\'s stock.',seeAll:true},
  ceo:{canCreateUsers:true,canDeleteUsers:true,allocateTo:['manager','teamleader','shopowner'],canAddStock:true,addStockNote:'You can add new stock straight into CEO master inventory.',seeAll:true},
  admin:{canCreateUsers:false,canDeleteUsers:false,allocateTo:['manager','teamleader','shopowner'],canAddStock:true,addStockNote:'As an Administrator, new stock you add goes into CEO master inventory for the CEO to allocate, or you can allocate it directly to a manager, team leader, or shop owner.',seeAll:true},
  regionalmanager:{canCreateUsers:true,canDeleteUsers:false,allocateTo:[],canAddStock:false,addStockNote:'Regional Managers oversee and train Managers in their region. Stock allocation still flows through the CEO or Administrators directly to Managers.',seeAll:false},
  manager:{canCreateUsers:false,canDeleteUsers:false,allocateTo:['agent'],canAddStock:false,addStockNote:'Managers cannot add brand-new stock. You can only allocate stock you have already received from the CEO or an Administrator, and only down to your own Agents.',seeAll:false},
  teamleader:{canCreateUsers:false,canDeleteUsers:false,allocateTo:['agent'],canAddStock:false,addStockNote:'Team Leaders cannot add brand-new stock. You can only allocate stock you have already received, and only down to Agents under you.',seeAll:false},
  agent:{canCreateUsers:false,canDeleteUsers:false,allocateTo:[],canAddStock:false,addStockNote:'Agents receive stock from a Manager or Team Leader. You cannot add new stock or allocate it onward — you can only sell it or return it.',seeAll:false},
  shopowner:{canCreateUsers:false,canDeleteUsers:false,allocateTo:[],canAddStock:false,addStockNote:'Shop Owners receive stock from the CEO or an Administrator. You cannot add new stock or allocate it onward — you can only sell it.',seeAll:false},
  recovery:{canCreateUsers:false,canDeleteUsers:false,allocateTo:[],canAddStock:false,addStockNote:'Recovery Officers work assigned cases and do not add or allocate stock.',seeAll:false},
};
const roleLabels={superadmin:'Super Administrator',ceo:'Chief Executive Officer',admin:'Administrator',regionalmanager:'Regional Manager',manager:'Manager',teamleader:'Team Leader',agent:'Agent',shopowner:'Shop Owner',recovery:'Recovery Officer'};
const roleAvaClass={superadmin:'ava-g',ceo:'ava-g',admin:'ava-p',regionalmanager:'ava-p',manager:'ava-b',teamleader:'ava-b',agent:'ava-e',shopowner:'ava-e',recovery:'ava-r'};
const roleIcon={superadmin:'fa-star',ceo:'fa-crown',admin:'fa-user-shield',regionalmanager:'fa-map-location-dot',manager:'fa-briefcase',teamleader:'fa-people-arrows',agent:'fa-user',shopowner:'fa-store',recovery:'fa-shield-alt'};
const roleIconColor={superadmin:'var(--amber)',ceo:'var(--amber)',admin:'var(--violet)',regionalmanager:'var(--violet)',manager:'var(--blue)',teamleader:'var(--blue)',agent:'var(--green)',shopowner:'var(--green)',recovery:'var(--red)'};

let currentUser=null;       // {uid, name, email, role, title, reportsTo}
let fbAuth=null;
let sessionStart=null;
let inactivityTimer=null;
let sessionTickInterval=null;

function initials(name){
  const parts=name.trim().split(' ').filter(Boolean);
  if(parts.length===0)return '?';
  if(parts.length===1)return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[1][0]).toUpperCase();
}

// ======================================================
// FIRST-TIME SETUP — creates the very first account (CEO)
// ======================================================
function checkFirstRun(){
  if(!fbDb){
    // Firebase never initialized (CDN blocked, offline, etc.) — go straight
    // to the login screen rather than waiting on a connection that will
    // never come.
    document.getElementById('loginScreen').classList.add('on');
    return;
  }
  // IMPORTANT: this checks a separate, publicly-readable "systemStatus"
  // flag rather than reading the protected "users" node directly. The
  // users node requires auth != null under the real security rules, and
  // before anyone has ever signed in, auth is always null — so checking
  // "is the database empty" against users itself would always be denied.
  // systemStatus/initialized is set to true once CEO setup completes,
  // and is safe to leave publicly readable since it reveals nothing
  // except "has this app been set up yet", not any real data.
  const dbCheck=fbDb.ref('systemStatus/initialized').once('value');
  const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),6000));
  Promise.race([dbCheck,timeout]).then(snap=>{
    if(snap.val()!==true){
      document.getElementById('loginScreen').classList.remove('on');
      document.getElementById('setupScreen').style.display='flex';
    }else{
      document.getElementById('loginScreen').classList.add('on');
    }
  }).catch(()=>{
    // Covers both a real Firebase error (e.g. rules not published yet)
    // and a slow/flaky connection that didn't respond in time — either
    // way, show the login screen rather than leaving the screen blank.
    document.getElementById('loginScreen').classList.add('on');
  });
}

function completeFirstTimeSetup(){
  const name=document.getElementById('setupName').value.trim();
  const email=document.getElementById('setupEmail').value.trim();
  const pass=document.getElementById('setupPass').value;
  const err=document.getElementById('setupErr');
  err.classList.remove('show');

  if(!name||!email||!pass){
    document.getElementById('setupErrText').textContent='Please fill in your name, email and a password.';
    err.classList.add('show');
    return;
  }
  if(pass.length<6){
    document.getElementById('setupErrText').textContent='Password must be at least 6 characters.';
    err.classList.add('show');
    return;
  }

  fbAuth.createUserWithEmailAndPassword(email,pass).then(cred=>{
    const uid=cred.user.uid;
    return fbDb.ref('users/'+uid).set({
      name,email,role:'superadmin',title:'Super Administrator',reportsTo:null,companyId:null,
      joined:new Date().toLocaleDateString(),status:'Active',createdAt:Date.now()
    });
  }).then(()=>{
    // Mark the system as initialized so future visits show the login
    // screen instead of this setup screen. This is the one write to
    // systemStatus that's allowed before anyone has signed in — see
    // the matching security rule, which only permits setting this
    // once, when it doesn't already exist.
    return fbDb.ref('systemStatus/initialized').set(true);
  }).then(()=>{
    document.getElementById('setupScreen').style.display='none';
    toast('Super Admin account created. Welcome to Monalisa Stock ERP.');
  }).catch(e=>{
    document.getElementById('setupErrText').textContent=friendlyAuthError(e);
    err.classList.add('show');
  });
}

function completeCompanyRegistration(){
  const f=id=>document.getElementById(id).value.trim();
  const bizName=f('regBizName'),bizNumber=f('regBizNumber'),bizEmail=f('regBizEmail'),bizPhone=f('regBizPhone'),
        bizAddress=f('regBizAddress'),country=f('regCountry'),region=f('regRegion'),district=f('regDistrict'),
        subCounty=f('regSubCounty'),parish=f('regParish'),village=f('regVillage'),
        ceoName=f('regCeoName'),ceoPhone=f('regCeoPhone');
  const err=document.getElementById('regErr');
  err.classList.remove('show');

  if(!bizName||!bizEmail||!bizPhone||!ceoName||!ceoPhone||!district){
    document.getElementById('regErrText').textContent='Please fill in at least the business name, business email and phone, your name and phone, and your district.';
    err.classList.add('show');
    return;
  }

  // companyId is generated from the CEO's own uid, since each CEO
  // registers exactly one company and this keeps the id stable and
  // collision-free without needing a separate id-generation scheme.
  const companyId='co_'+currentUser.uid;

  const companyProfile={
    businessName:bizName,businessNumber:bizNumber||'—',businessEmail:bizEmail,businessPhone:bizPhone,
    businessAddress:bizAddress||'—',country:country||'Uganda',region:region||'—',district,
    subCounty:subCounty||'—',parish:parish||'—',village:village||'—',
    ceoName:ceoName,ceoPhone:ceoPhone,registeredAt:Date.now()
  };

  fbDb.ref('companies/'+companyId+'/profile').set(companyProfile).then(()=>{
    // subscription defaults to pending — only the Super Admin can mark
    // it active, per the security rules. The "simulate payment" button
    // on the lock screen is a demo-only bypass of that, for testing.
    return fbDb.ref('companies/'+companyId+'/subscription').set({status:'pending',plan:'standard-monthly',registeredAt:Date.now()});
  }).then(()=>{
    // company-specific contact details, defaulting to Monalisa Tech
    // Solutions' own number/email until the CEO changes them under
    // Integrations — this is what makes "kabuusumonalisa@gmail.com and
    // +256703953711 aren't used again" actually achievable per company.
    return fbDb.ref('companies/'+companyId+'/settings').set({
      whatsappNumber:ceoPhone,supportEmail:bizEmail,commissionRates:{agent:3,teamleader:1.5,manager:0.8}
    });
  }).then(()=>{
    return fbDb.ref('users/'+currentUser.uid+'/companyId').set(companyId);
  }).then(()=>{
    currentUser.companyId=companyId;
    document.getElementById('companyRegScreen').style.display='none';
    toast('Company registered. One more step — activating your subscription.');
    checkSubscriptionThenBoot();
  }).catch(e=>{
    document.getElementById('regErrText').textContent=friendlyAuthError(e)||'Could not save your company details. Please try again.';
    err.classList.add('show');
  });
}

// ======================================================
// LOGIN SCREEN
// ======================================================
function togglePw(){
  const f=document.getElementById('loginPass');
  const i=document.getElementById('pwIcon');
  if(f.type==='password'){f.type='text';i.className='fas fa-eye-slash'}
  else{f.type='password';i.className='fas fa-eye'}
}

function friendlyAuthError(e){
  const code=e&&e.code?e.code:'';
  if(code.includes('wrong-password')||code.includes('invalid-credential'))return 'Incorrect email or password.';
  if(code.includes('user-not-found'))return 'No account found with that email.';
  if(code.includes('invalid-email'))return 'That doesn\'t look like a valid email address.';
  if(code.includes('too-many-requests'))return 'Too many attempts. Please wait a few minutes and try again.';
  if(code.includes('network-request-failed'))return 'Could not reach the server. Check your internet connection.';
  if(code.includes('email-already-in-use'))return 'That email is already registered.';
  if(code.includes('weak-password'))return 'Please choose a stronger password (at least 6 characters).';
  return e&&e.message?e.message:'Something went wrong. Please try again.';
}

function attemptLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPass').value.trim();
  const err=document.getElementById('loginErr');
  const btn=document.getElementById('loginBtn');
  const btnText=document.getElementById('loginBtnText');
  err.classList.remove('show');

  if(!email||!pass){
    document.getElementById('loginErrText').textContent='Please enter both your email and password.';
    err.classList.add('show');
    return;
  }
  if(!fbAuth){
    document.getElementById('loginErrText').textContent='Could not connect to the server. Check your internet connection and reload the page.';
    err.classList.add('show');
    return;
  }

  btn.disabled=true;
  btnText.textContent='Checking credentials...';

  fbAuth.signInWithEmailAndPassword(email,pass).then(cred=>{
    btnText.textContent='Welcome back...';
    return fbDb.ref('users/'+cred.user.uid).once('value');
  }).then(snap=>{
    const profile=snap.val();
    btn.disabled=false;
    btnText.textContent='Sign in';
    if(!profile){
      document.getElementById('loginErrText').textContent='Your account has no profile on record. Ask the CEO to recreate your login.';
      err.classList.add('show');
      fbAuth.signOut();
      return;
    }
    if(profile.status==='Suspended'){
      document.getElementById('loginErrText').textContent='This account has been suspended. Contact the CEO.';
      err.classList.add('show');
      fbAuth.signOut();
      return;
    }
    logUserIn(snap.key,profile);
  }).catch(e=>{
    btn.disabled=false;
    btnText.textContent='Sign in';
    document.getElementById('loginErrText').textContent=friendlyAuthError(e);
    err.classList.add('show');
  });
}

function sendPasswordReset(){
  const email=document.getElementById('loginEmail').value.trim();
  if(!email){
    toast('Type your email above first, then tap "Forgot password" again','var(--amber)');
    return;
  }
  fbAuth.sendPasswordResetEmail(email).then(()=>{
    toast('Password reset link sent to '+email);
  }).catch(e=>{
    toast(friendlyAuthError(e),'var(--red)');
  });
}

function logUserIn(uid,profile){
  currentUser={
    uid,
    name:profile.name,
    email:profile.email,
    role:profile.role,
    title:profile.title||roleLabels[profile.role],
    reportsTo:profile.reportsTo,
    companyId:profile.companyId||null,
    ava:initials(profile.name),
    cls:roleAvaClass[profile.role]||'ava-g',
    icon:roleIcon[profile.role]||'fa-user',
    iconColor:roleIconColor[profile.role]||'var(--green)'
  };
  sessionStart=Date.now();
  document.getElementById('loginScreen').classList.remove('on');

  // Super Admin never belongs to a company — straight into the app.
  if(currentUser.role==='superadmin'){
    bootApp();
    return;
  }

  // A CEO who has never registered their company yet (no companyId set)
  // gets sent to company registration instead of the normal dashboard.
  // Every other role is created BY a CEO who already filled this in, so
  // they should always already have a companyId by the time they exist.
  if(currentUser.role==='ceo'&&!currentUser.companyId){
    document.getElementById('companyRegScreen').style.display='flex';
    return;
  }

  // Check subscription status before letting anyone into the real app,
  // except the Super Admin (handled above) who isn't tied to a company.
  checkSubscriptionThenBoot();
}

function checkSubscriptionThenBoot(){
  // SUBSCRIPTION ENFORCEMENT IS TEMPORARILY OFF while the system is
  // still being built and tested. The app boots normally for every
  // company regardless of payment status, so the rest of the system
  // can keep being tested without getting blocked here. The original
  // hard lock screen (showSubscriptionLock) is still in the code below,
  // unused for now -- turning real enforcement back on later is a one
  // line change: call showSubscriptionLock(sub) instead of bootApp()
  // when sub.status !== 'active'.
  if(!currentUser.companyId){
    bootApp();
    return;
  }
  fbDb.ref('companies/'+currentUser.companyId+'/subscription').once('value').then(snap=>{
    const sub=snap.val()||{status:'pending'};
    currentUser.subscriptionStatus=sub.status;
    bootApp();
    if(sub.status!=='active'){
      showBillingComingSoonBanner();
    }
  }).catch(()=>{
    currentUser.subscriptionStatus='pending';
    bootApp();
    showBillingComingSoonBanner();
  });
}

function showBillingComingSoonBanner(){
  // A small, dismissible, non-blocking reminder rather than a wall --
  // this is what "subscription optional for now" looks like day to day.
  if(document.getElementById('billingSoonBanner'))return;
  const banner=document.createElement('div');
  banner.id='billingSoonBanner';
  banner.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:1px solid var(--border2);padding:10px 16px;display:flex;align-items:center;gap:10px;z-index:600;font-size:12px;flex-wrap:wrap';
  banner.innerHTML='<i class="fas fa-circle-info" style="color:var(--amber)"></i><span style="flex:1;min-width:200px">Billing is under development \u2014 subscription plans are coming soon after full rollout. Everything is unlocked for now.</span><button onclick="document.getElementById(\'billingSoonBanner\').remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:4px"><i class="fas fa-times"></i></button>';
  document.body.appendChild(banner);
}

function showSubscriptionLock(sub){
  fbDb.ref('companies/'+currentUser.companyId+'/profile/businessName').once('value').then(snap=>{
    document.getElementById('subLockCompanyName').textContent=snap.val()||'Your company';
  });
  const statusEl=document.getElementById('subLockStatus');
  if(sub.status==='suspended'){
    statusEl.textContent='Suspended';statusEl.className='badge b-r';
    document.getElementById('subLockTitle').textContent='Subscription suspended';
    document.getElementById('subLockText').textContent='Your company\'s subscription has been suspended by Monalisa Tech Solutions. Contact support to resolve this.';
  }else{
    statusEl.textContent='Pending payment';statusEl.className='badge b-a';
  }
  document.getElementById('subscriptionLockScreen').style.display='flex';
}

function simulatePayment(){
  // DEMO ONLY: this simulates a successful payment so the front end can
  // be tested end to end. Real billing isn't connected yet — only the
  // Super Admin's database write actually controls subscription.status
  // for real per the security rules. This button calls a path that, in
  // the real system, only Monalisa Tech Solutions (Super Admin) should
  // be allowed to set — for the demo it's left open so you can test the
  // unlocked state without needing a second Super Admin login.
  if(!currentUser.companyId)return;
  fbDb.ref('companies/'+currentUser.companyId+'/subscription').update({
    status:'active',lastPaymentAt:Date.now(),simulatedPayment:true
  }).then(()=>{
    document.getElementById('subscriptionLockScreen').style.display='none';
    toast('Payment simulated — subscription active');
    bootApp();
  }).catch(()=>{
    toast('Could not update subscription. Check security rules allow this for testing.','var(--red)');
  });
}

// ======================================================
// LOCK SCREEN / SESSION TIMEOUT
// ======================================================
function resetInactivity(){
  clearTimeout(inactivityTimer);
  if(!currentUser)return;
  inactivityTimer=setTimeout(()=>{
    document.getElementById('lockScreen').classList.add('on');
  },5*60*1000); // 5 minutes
}
['mousemove','keydown','click','scroll','touchstart'].forEach(evt=>{
  document.addEventListener(evt,resetInactivity);
});

function unlockSession(){
  const p=document.getElementById('unlockPass').value;
  if(!currentUser){forceLogout();return}
  fbAuth.signInWithEmailAndPassword(currentUser.email,p).then(()=>{
    document.getElementById('lockScreen').classList.remove('on');
    document.getElementById('unlockPass').value='';
    toast('Welcome back, '+currentUser.name.split(' ')[0]);
    resetInactivity();
  }).catch(()=>{
    toast('Incorrect password','var(--red)');
  });
}
function forceLogout(){
  document.getElementById('lockScreen').classList.remove('on');
  doLogout();
}

function startSessionTimer(){
  clearInterval(sessionTickInterval);
  sessionTickInterval=setInterval(()=>{
    if(!sessionStart)return;
    const mins=Math.floor((Date.now()-sessionStart)/60000);
    const el=document.getElementById('sessionTimer');
    if(el)el.textContent='Active '+mins+'m';
  },10000);
}

// ======================================================
// LOGOUT
// ======================================================
function toggleLogoutMenu(){document.getElementById('logoutMenu').classList.toggle('open')}
function closeLogoutMenu(){document.getElementById('logoutMenu').classList.remove('open')}
document.addEventListener('click',e=>{
  if(!e.target.closest('#sbUser')&&!e.target.closest('#logoutMenu'))closeLogoutMenu();
});
function doLogout(){
  closeLogoutMenu();
  fbAuth.signOut();
  document.getElementById('app').classList.remove('on');
  document.getElementById('app').style.display='none';
  currentUser=null;
  sessionStart=null;
  clearInterval(sessionTickInterval);
  clearTimeout(inactivityTimer);
  document.getElementById('loginEmail').value='';
  document.getElementById('loginPass').value='';
  document.getElementById('loginScreen').classList.add('on');
}

// ======================================================
// APPLY PERMISSIONS THROUGHOUT THE UI
// ======================================================
function applyPermissions(){
  const u=currentUser;
  const p=perms[u.role]||perms.agent;

  document.getElementById('sbName').textContent=u.name;
  document.getElementById('sbRole').textContent=u.title;

  // hide irrelevant Users-page tabs for roles who can't see those people anyway
  const ceoOnlyTabs=['tabAdmins','tabManagers','tabShops','tabRecovery'];
  ceoOnlyTabs.forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=(u.role==='ceo'||u.role==='admin')?'inline-block':'none';
  });
  const av=document.getElementById('sbAva');
  av.textContent=u.ava;av.className='ava '+u.cls;
  const ri=document.getElementById('roleIco').querySelector('i');
  ri.className='fas '+u.icon;ri.style.color=u.iconColor;

  // nav visibility: CEO-only sections
  const ceoOnlyNav=['nav-users','nav-auditlogs','nav-security','nav-integrations','nav-settings'];
  const ceoAdminNav=['nav-ceo'];
  ceoOnlyNav.forEach(id=>{
    const n=document.getElementById(id);
    if(n)n.style.display=(u.role==='ceo'||u.role==='admin')?'flex':'none';
  });
  ceoAdminNav.forEach(id=>{
    const n=document.getElementById(id);
    if(n)n.style.display=(u.role==='ceo'||u.role==='admin')?'flex':'none';
  });

  // Super Admin sits above every company and has no use for any of the
  // day-to-day operational pages — only Dashboard (their company
  // overview) makes sense for that role.
  const operationalNav=['nav-inventory','nav-warehouses','nav-allocation','nav-sales','nav-customers','nav-financing','nav-recovery','nav-commissions','nav-performance','nav-reports','nav-uganda'];
  if(u.role==='superadmin'){
    operationalNav.forEach(id=>{const n=document.getElementById(id);if(n)n.style.display='none'});
    ceoOnlyNav.forEach(id=>{const n=document.getElementById(id);if(n)n.style.display='none'});
  }

  // Warehouses, Financing Integration, and Uganda Analytics are
  // company-wide / region-wide views that don't make sense for anyone
  // running day-to-day field operations — restricted to CEO, Admin,
  // and Regional Manager only.
  const restrictedToTopTier=['nav-warehouses','nav-financing','nav-uganda'];
  restrictedToTopTier.forEach(id=>{
    const n=document.getElementById(id);
    if(n)n.style.display=['ceo','admin','regionalmanager'].includes(u.role)?'flex':'none';
  });

  // Add Stock button on inventory page
  const addBtn=document.getElementById('addStockBtn');
  const invBanner=document.getElementById('invPermBanner');
  const invText=document.getElementById('invPermText');
  if(addBtn){
    addBtn.style.display=p.canAddStock?'inline-flex':'none';
  }
  if(invBanner&&invText){
    if(!p.canAddStock){
      invBanner.style.display='flex';
      invText.textContent=p.addStockNote;
    }else{
      invBanner.style.display='none';
    }
  }

  // Allocation page permission banner + button
  const allocBanner=document.getElementById('allocPermBanner');
  const allocText=document.getElementById('allocPermText');
  const newAllocBtn=document.getElementById('newAllocBtn');
  if(allocBanner&&allocText){
    if(p.allocateTo.length===0){
      allocBanner.style.display='flex';
      allocText.textContent=p.addStockNote.replace('add new stock','allocate stock')+' You can only confirm receipt and then sell or return your stock.';
      if(newAllocBtn)newAllocBtn.style.display='none';
    }else{
      allocBanner.style.display='none';
      if(newAllocBtn)newAllocBtn.style.display='inline-flex';
    }
  }

  // Users page
  const createUserBtn=document.getElementById('createUserBtn');
  const usersBanner=document.getElementById('usersPermBanner');
  const canCreateAny=(perms[u.role]&&['ceo','admin','manager','teamleader'].includes(u.role));
  if(createUserBtn){
    createUserBtn.style.display=canCreateAny?'inline-flex':'none';
    if(u.role==='admin')createUserBtn.innerHTML='<i class="fas fa-user-plus"></i>Create login';
    else if(u.role==='manager'||u.role==='teamleader')createUserBtn.innerHTML='<i class="fas fa-user-plus"></i>Add an agent';
  }
  if(usersBanner){
    const bannerText=usersBanner.querySelector('span');
    if(u.role==='ceo'){
      usersBanner.style.display='none';
    }else{
      usersBanner.style.display='flex';
      if(bannerText){
        if(u.role==='admin')bannerText.textContent='You can see and manage everyone except the CEO\'s own record. Only the CEO can create Administrator or Manager logins.';
        else if(u.role==='manager')bannerText.textContent='You can see and manage your own Team Leaders and Agents only. You cannot see other managers\' teams.';
        else if(u.role==='teamleader')bannerText.textContent='You can see and manage your own Agents only.';
        else bannerText.textContent='You can only see your own account here.';
      }
    }
  }

  updateGreeting();
  buildAllocateOptions();
}

// ======================================================
// SCOPED VISIBILITY — who can see/manage whom
// ======================================================
// Returns the list of users currentUser is allowed to see, per the rule:
// - CEO sees everyone, including all Admins
// - Admin sees everyone EXCEPT the CEO record itself
// - Manager sees only their own direct reports (by reportsTo == their uid),
//   plus, transitively, that Team Leader's own Agents
// - Everyone else sees only themselves
function resolveReportsTo(uid){
  if(!uid)return '—';
  if(currentUser&&uid===currentUser.uid)return 'You';
  const found=usersList.find(u=>u.uid===uid);
  return found?found.name:'—';
}

function getVisibleUsers(){
  if(!currentUser)return [];
  if(currentUser.role==='superadmin')return usersList; // oversees every company
  // every other role is scoped to their OWN company first, no exceptions
  const sameCompany=usersList.filter(u=>u.companyId===currentUser.companyId);
  if(currentUser.role==='ceo')return sameCompany;
  if(currentUser.role==='admin')return sameCompany.filter(u=>u.role!=='ceo');
  if(currentUser.role==='regionalmanager'){
    // Managers who report directly to this Regional Manager, plus their
    // entire downline (Team Leaders, then those Team Leaders' Agents)
    const directManagers=sameCompany.filter(u=>u.reportsTo===currentUser.uid);
    const managerUids=new Set(directManagers.map(u=>u.uid));
    const teamLeaders=sameCompany.filter(u=>managerUids.has(u.reportsTo));
    const tlUids=new Set(teamLeaders.map(u=>u.uid));
    const agentsAndShops=sameCompany.filter(u=>tlUids.has(u.reportsTo)||managerUids.has(u.reportsTo));
    return [...directManagers,...teamLeaders,...agentsAndShops];
  }
  if(currentUser.role==='manager'){
    const direct=sameCompany.filter(u=>u.reportsTo===currentUser.uid);
    const directUids=new Set(direct.map(u=>u.uid));
    const indirect=sameCompany.filter(u=>directUids.has(u.reportsTo));
    return [...direct,...indirect];
  }
  if(currentUser.role==='teamleader'){
    return sameCompany.filter(u=>u.reportsTo===currentUser.uid);
  }
  // agents, shop owners, recovery officers see only themselves
  return sameCompany.filter(u=>u.uid===currentUser.uid);
}

// ======================================================
// TERRITORY SCOPING — devices and customers
// ======================================================
// Returns true if currentUser is allowed to see this specific device,
// based on who currently holds it (by their real Firebase uid).
// CEO and Admin see everything. Everyone else only sees stock held by
// themselves or by someone in their own downline (their own team).
function canSeeDevice(d){
  if(!currentUser)return false;
  if(currentUser.role==='ceo'||currentUser.role==='admin')return true;
  if(!d.holderUid)return true; // seed/demo rows with no real holder yet stay visible so the demo isn't empty
  if(d.holderUid===currentUser.uid)return true;
  const myTeamUids=new Set(getVisibleUsers().map(u=>u.uid));
  return myTeamUids.has(d.holderUid);
}
function canSeeCustomer(c){
  if(!currentUser)return false;
  if(currentUser.role==='ceo'||currentUser.role==='admin')return true;
  if(!c.agentUid)return true; // seed/demo rows with no real agent yet stay visible
  if(c.agentUid===currentUser.uid)return true;
  const myTeamUids=new Set(getVisibleUsers().map(u=>u.uid));
  return myTeamUids.has(c.agentUid);
}
function visibleDevices(){return devices.filter(canSeeDevice)}

// ======================================================
// STOCK EFFICIENCY ENGINE
// ======================================================
// Per-device aging bands shown on device cards/tables stay the
// existing 9/20-day system, unchanged.
//
// Separately, every Agent, Team Leader, Shop Owner, and Manager gets
// an automatic "stock quotient" — a 0-100% efficiency score based on
// how much of their CURRENTLY HELD stock is aged, using the new
// 10/15-day bands you specified:
//   green  = under 10 days held  -> counts as "fresh", full credit
//   orange = 10 to 15 days held  -> counts as "moderate", partial credit
//   red    = over 15 days held   -> counts as "aged", no credit
// Quotient = 100 when someone holds zero aged stock, and declines as
// more of what they hold is moderate or aged. This applies the moment
// stock is allocated to them — there's no separate setup step.
function newBand(ageDays){
  if(ageDays<10)return 'green';
  if(ageDays<=15)return 'orange';
  return 'red';
}
function stockQuotientFor(uid){
  const held=devices.filter(d=>d.holderUid===uid&&d.status!=='sold');
  if(held.length===0)return {quotient:100,total:0,green:0,orange:0,red:0};
  let green=0,orange=0,red=0;
  held.forEach(d=>{
    const b=newBand(d.age);
    if(b==='green')green++;else if(b==='orange')orange++;else red++;
  });
  // full credit for green, half credit for orange, none for red
  const score=((green*1)+(orange*0.5)+(red*0))/held.length*100;
  return {quotient:Math.round(score),total:held.length,green,orange,red};
}
// A Manager's own quotient is determined by the COMBINED aged stock of
// everyone in their downline (their Team Leaders and that TL's Agents),
// not just stock the Manager personally holds — per your instruction
// that "aged stock on both team leader and agent affects his
// efficiency." Team Leaders are scored the same way, across their own
// Agents.
function teamStockQuotientFor(uid,role){
  let teamUids=[];
  if(role==='manager'){
    const direct=usersList.filter(u=>u.reportsTo===uid);
    const directUids=new Set(direct.map(u=>u.uid));
    const indirect=usersList.filter(u=>directUids.has(u.reportsTo));
    teamUids=[...direct,...indirect].map(u=>u.uid);
  }else if(role==='teamleader'){
    teamUids=usersList.filter(u=>u.reportsTo===uid).map(u=>u.uid);
  }
  const held=devices.filter(d=>teamUids.includes(d.holderUid)&&d.status!=='sold');
  if(held.length===0)return {quotient:100,total:0,green:0,orange:0,red:0};
  let green=0,orange=0,red=0;
  held.forEach(d=>{
    const b=newBand(d.age);
    if(b==='green')green++;else if(b==='orange')orange++;else red++;
  });
  const score=((green*1)+(orange*0.5)+(red*0))/held.length*100;
  return {quotient:Math.round(score),total:held.length,green,orange,red};
}
function quotientColor(q){return q>=80?'var(--green)':q>=50?'var(--amber)':'var(--red)'}
function quotientBadgeClass(q){return q>=80?'b-g':q>=50?'b-a':'b-r'}

function visibleCustomers(){return customers.filter(canSeeCustomer)}

function toggleRoleSpecificFields(role){
  const teamField=document.getElementById('teamNameField');
  const regionalFields=document.getElementById('regionalManagerFields');
  if(teamField)teamField.style.display=(role==='manager'||role==='teamleader')?'block':'none';
  if(regionalFields)regionalFields.style.display=(role==='regionalmanager')?'block':'none';
}

function populateReportsTo(){
  const sel=document.getElementById('nuReportsTo');
  const roleSel=document.getElementById('nuRole');
  if(!sel||!roleSel)return;

  // restrict which roles THIS user is allowed to create
  const allowedRoles={
    superadmin:[],
    ceo:['admin','regionalmanager','manager','teamleader','agent','shopowner','recovery'],
    admin:['manager','teamleader','agent','shopowner','recovery'],
    regionalmanager:['manager'],
    manager:['agent'],
    teamleader:['agent'],
  };
  const allowed=allowedRoles[currentUser.role]||[];
  const currentRoleVal=roleSel.value;
  roleSel.innerHTML=allowed.map(r=>`<option value="${r}">${roleLabels[r]}</option>`).join('');
  if(allowed.includes(currentRoleVal))roleSel.value=currentRoleVal;
  const roleBeingCreated=roleSel.value;
  toggleRoleSpecificFields(roleBeingCreated);

  // who is eligible to be "reports to" depends on the ROLE BEING CREATED,
  // following the hierarchy exactly as specified:
  //   Agent reports to a Manager OR a Team Leader
  //   Team Leader reports to a Manager only
  //   Manager reports to a Regional Manager if the company has one,
  //     otherwise to the CEO or an Administrator directly
  //   Shop Owner reports to the CEO or an Administrator only
  //   Regional Manager, Administrator, Recovery Officer report to the CEO
  let eligible=[];
  const myCompanyUsers=usersList.filter(u=>u.companyId===currentUser.companyId);
  if(roleBeingCreated==='agent'){
    eligible=myCompanyUsers.filter(u=>u.role==='manager'||u.role==='teamleader');
  }else if(roleBeingCreated==='teamleader'){
    eligible=myCompanyUsers.filter(u=>u.role==='manager');
  }else if(roleBeingCreated==='manager'){
    // a Manager can report to a Regional Manager (if the company uses
    // that tier) or straight to the CEO/Admin — whoever is creating
    // the Manager picks the right one from this combined list
    eligible=myCompanyUsers.filter(u=>u.role==='regionalmanager'||u.role==='ceo'||u.role==='admin');
    if(currentUser.role==='ceo')eligible=[{uid:currentUser.uid,name:currentUser.name+' (you, CEO)'},...eligible.filter(u=>u.uid!==currentUser.uid)];
    if(currentUser.role==='regionalmanager')eligible=[{uid:currentUser.uid,name:currentUser.name+' (you, Regional Manager)'},...eligible.filter(u=>u.uid!==currentUser.uid)];
  }else if(roleBeingCreated==='shopowner'){
    eligible=myCompanyUsers.filter(u=>u.role==='ceo'||u.role==='admin');
    if(currentUser.role==='ceo')eligible=[{uid:currentUser.uid,name:currentUser.name+' (you, CEO)'},...eligible.filter(u=>u.uid!==currentUser.uid)];
  }else if(roleBeingCreated==='admin'||roleBeingCreated==='recovery'||roleBeingCreated==='regionalmanager'){
    eligible=myCompanyUsers.filter(u=>u.role==='ceo');
    if(currentUser.role==='ceo')eligible=[{uid:currentUser.uid,name:currentUser.name+' (you, CEO)'}];
  }
  // if the current user themself qualifies as a valid target and isn't
  // already included above, make sure they appear (covers Manager
  // creating their own Agent, Team Leader creating their own Agent, etc.)
  if((roleBeingCreated==='agent'&&(currentUser.role==='manager'||currentUser.role==='teamleader'))||
     (roleBeingCreated==='teamleader'&&currentUser.role==='manager')){
    if(!eligible.some(u=>u.uid===currentUser.uid)){
      eligible=[{uid:currentUser.uid,name:currentUser.name+' (you)'},...eligible];
    }
  }

  sel.innerHTML=eligible.length
    ? eligible.map(u=>`<option value="${u.uid}">${roleLabels[u.role]||''} ${u.name}</option>`).join('')
    : '<option value="">No eligible options yet — create the right role first</option>';
}

function buildAllocateOptions(){
  const u=currentUser;
  const p=perms[u.role]||perms.agent;
  const toSelect=document.getElementById('allocTo');
  if(!toSelect)return;
  const visible=getVisibleUsers();
  let html='';
  p.allocateTo.forEach(role=>{
    visible.filter(v=>v.role===role&&v.status==='Active').forEach(v=>{
      html+=`<option value="${v.uid}">${roleLabels[v.role]} — ${v.name}</option>`;
    });
  });
  toSelect.innerHTML=html||'<option value="">No eligible recipients yet — create one under Users first</option>';

  const banner=document.getElementById('allocModalBanner');
  const text=document.getElementById('allocModalText');
  if(banner&&text){
    if(u.role==='manager'||u.role==='teamleader'){
      banner.style.display='flex';
      text.textContent='You can only allocate stock to Agents under you, and only from units you already hold.';
    }else{
      banner.style.display='none';
    }
  }

  const addDevDest=document.getElementById('addDevDest');
  if(addDevDest){
    addDevDest.innerHTML=u.role==='ceo'
      ? '<option>CEO Master Inventory</option>'
      : '<option>CEO Master Inventory (pending CEO review)</option><option>Allocate directly to a Manager</option><option>Allocate directly to a Shop Owner</option>';
    const addDevBanner=document.getElementById('addDevBanner');
    const addDevText=document.getElementById('addDevText');
    if(addDevBanner&&u.role==='admin'){
      addDevBanner.style.display='flex';
      addDevText.textContent='As an Administrator, stock you add can go to CEO master inventory or be allocated immediately — your choice below.';
    }
  }
}

// ======================================================
// NAV
// ======================================================
const titles={dashboard:'Dashboard',ceo:'CEO Command Center',inventory:'Inventory',allocation:'Stock Allocation',sales:'Sales',customers:'Customers',financing:'Financing Integration',recovery:'Recovery Management',commissions:'Commissions',performance:'Performance Center',reports:'Reports',uganda:'Uganda Analytics',warehouses:'Warehouses',users:'User Management',auditlogs:'Audit Logs',security:'Security Center',integrations:'Integrations',settings:'Settings'};

function go(id){
  // block CEO-only pages for non-ceo/admin
  const restricted=['ceo','users','auditlogs','security','integrations','settings'];
  if(restricted.includes(id)&&currentUser&&!['ceo','admin'].includes(currentUser.role)){
    toast("You don't have access to this section",'var(--red)');
    return;
  }
  // block top-tier-only pages: Warehouses, Financing, Uganda Analytics
  const topTierOnly=['warehouses','financing','uganda'];
  if(topTierOnly.includes(id)&&currentUser&&!['ceo','admin','regionalmanager'].includes(currentUser.role)){
    toast("You don't have access to this section",'var(--red)');
    return;
  }
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nav').forEach(n=>n.classList.remove('on'));
  const pg=document.getElementById('pg-'+id);
  const nv=document.getElementById('nav-'+id);
  if(pg)pg.classList.add('on');
  if(nv)nv.classList.add('on');
  document.getElementById('pageTitle').textContent=titles[id]||id;
  window.scrollTo({top:0,behavior:'smooth'});
  closeSb();
  if(id==='inventory')renderGrid(visibleDevices()),renderTable(visibleDevices());
  if(id==='customers')renderCustomers(visibleCustomers());
  if(id==='users')renderUsers('');
  if(id==='allocation'){renderPendingAllocations();renderRecentMovements();}
  if(id==='settings')loadCompanySettingsPage();
  if(id==='recovery')renderRecoveryQueue('aged');
  if(id==='warehouses')loadWarehousesPage();
  if(id==='commissions')renderCommissions('all');
  if(id==='dashboard')renderDashboard();
  setTimeout(()=>buildCharts(id),60);
}

function toggleSb(){document.getElementById('sb').classList.toggle('open');document.getElementById('sbOverlay').classList.toggle('on')}
function closeSb(){document.getElementById('sb').classList.remove('open');document.getElementById('sbOverlay').classList.remove('on')}

function setTab(el,grp){
  const cont=grp?document.getElementById(grp):el.closest('.tabs');
  if(cont)cont.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
}

function openM(id){
  document.getElementById(id).classList.add('open');
  if(id==='mAllocate')loadAllocIMEI();
  if(id==='mAddDevice')buildAllocateOptions();
  if(id==='mCreateUser')populateReportsTo();
  if(id==='mReportIssue')populateIssueDeviceSelect();
}
function closeM(id){document.getElementById(id).classList.remove('open')}
document.querySelectorAll('.mwrap').forEach(m=>m.addEventListener('click',function(e){if(e.target===this)this.classList.remove('open')}));

function presetRole(role){
  setTimeout(()=>{const s=document.getElementById('nuRole');if(s)s.value=role},80);
}

function toggleNotif(){document.getElementById('notifPanel').classList.toggle('open')}
function clearNotifs(){document.querySelectorAll('.ni.unread').forEach(n=>n.classList.remove('unread'));toast('All notifications cleared')}
document.addEventListener('click',e=>{if(!e.target.closest('#notifPanel')&&!e.target.closest('.ico'))document.getElementById('notifPanel').classList.remove('open')});

function toggleFS(){if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});else document.exitFullscreen()}

function toast(msg,c='var(--green)'){
  const t=document.getElementById('toast');
  t.textContent=msg;t.style.borderColor=c;
  t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)';
  clearTimeout(t._t);
  t._t=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(-50%) translateY(20px)'},2800);
}

// ======================================================
// SECURITY TOGGLES
// ======================================================
function toggleSetting(el){
  el.classList.toggle('on');
  toast(el.classList.contains('on')?'Setting turned on':'Setting turned off');
}

// ======================================================
// WHATSAPP + EMAIL INTEGRATIONS
// ======================================================
const COMPANY_WHATSAPP='256703953711';
const COMPANY_EMAIL='kabuusumonalisa@gmail.com';

function openWA(message){
  const url='https://wa.me/'+COMPANY_WHATSAPP+'?text='+encodeURIComponent(message);
  window.open(url,'_blank');
}
function openMail(subject,body){
  const url='mailto:'+COMPANY_EMAIL+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
  window.location.href=url;
}

function testWA(){
  openWA('Hello Monalisa, this is a test message from Monalisa Stock ERP. WhatsApp integration is working correctly.');
  toast('Opening WhatsApp...');
}
function testEmail(){
  openMail('Test message from Monalisa Stock ERP','Hello Monalisa,\n\nThis is a test email confirming the integration between Monalisa Stock ERP and your inbox is working correctly.\n\nSent by: '+(currentUser?currentUser.name:'System'));
  toast('Opening your email app...');
}

function downloadInventoryPDF(){
  try{
    const { jsPDF }=window.jspdf;
    const doc=new jsPDF({unit:'mm',format:'a4'});
    const list=visibleDevices();

    doc.setFont('helvetica','bold');doc.setFontSize(14);
    doc.text('Monalisa Tech Solutions — Inventory Status',14,16);
    doc.setFont('helvetica','normal');doc.setFontSize(9);
    doc.text('Generated '+new Date().toLocaleString()+' by '+currentUser.name+' ('+(roleLabels[currentUser.role]||currentUser.role)+')',14,22);
    doc.text(list.length+' device(s) visible to your account',14,27);

    let y=36;
    doc.setFont('helvetica','bold');doc.setFontSize(8);
    const cols=[['IMEI',14],['Brand / Model',55],['Specs',105],['Sell price',135],['Holder',160],['Age',188]];
    cols.forEach(([label,x])=>doc.text(label,x,y));
    y+=2;doc.setDrawColor(150);doc.line(14,y,196,y);y+=5;

    doc.setFont('helvetica','normal');doc.setFontSize(7.5);
    list.forEach(d=>{
      if(y>280){doc.addPage();y=16;}
      doc.text(d.imei,14,y);
      doc.text((d.brand+' '+d.model).slice(0,28),55,y);
      doc.text((d.ram+'/'+d.storage),105,y);
      doc.text('UGX '+d.sell.toLocaleString(),135,y);
      doc.text((d.holder||'—').slice(0,16),160,y);
      doc.text(d.age+'d',188,y);
      y+=5.5;
    });

    doc.save('inventory-status-'+new Date().toISOString().slice(0,10)+'.pdf');
    toast('Inventory PDF downloaded');
    fbLogAction('REPORT_PDF',currentUser.name+' downloaded the inventory status PDF');
  }catch(e){
    console.error(e);
    toast('Could not generate the PDF. Try again.','var(--red)');
  }
}

function downloadReceiptPDF(){
  try{
    const { jsPDF }=window.jspdf;
    const doc=new jsPDF({unit:'mm',format:[80,150]}); // narrow receipt-style page

    const nr=document.getElementById('r-nr').textContent;
    const cust=document.getElementById('r-cust').textContent;
    const phone=document.getElementById('r-phone').textContent;
    const nid=document.getElementById('r-nid').textContent;
    const agent=document.getElementById('r-agent').textContent;
    const brand=document.getElementById('r-brand').textContent;
    const model=document.getElementById('r-model').textContent;
    const specs=document.getElementById('r-specs').textContent;
    const color=document.getElementById('r-color').textContent;
    const imei=document.getElementById('r-imei').textContent;
    const type=document.getElementById('r-type').textContent;
    const total=document.getElementById('r-total').textContent;

    let y=10;
    doc.setFont('helvetica','bold');doc.setFontSize(12);
    doc.text('MONALISA TECH SOLUTIONS',40,y,{align:'center'});y+=5;
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);
    doc.text('Kampala, Uganda, East Africa',40,y,{align:'center'});y+=3.5;
    doc.text('+256703953711  |  kabuusumonalisa@gmail.com',40,y,{align:'center'});y+=6;

    doc.setDrawColor(180);doc.setLineDashPattern([1,1],0);
    doc.line(6,y,74,y);y+=5;

    doc.setFont('helvetica','bold');doc.setFontSize(8.5);
    doc.text(nr,40,y,{align:'center'});y+=7;

    doc.setFont('helvetica','normal');doc.setFontSize(8);
    const row=(label,val)=>{
      doc.text(label,6,y);
      doc.setFont('helvetica','bold');
      doc.text(String(val),74,y,{align:'right'});
      doc.setFont('helvetica','normal');
      y+=5;
    };
    row('Date',new Date().toLocaleDateString());
    row('Time',new Date().toLocaleTimeString());
    row('Customer',cust);
    row('Phone',phone);
    row('National ID',nid);
    row('Sold by',agent);

    y+=1;doc.line(6,y,74,y);y+=5;

    row('Brand',brand);
    row('Model',model);
    row('Specs',specs);
    row('Color',color);
    doc.setFontSize(6.5);
    row('IMEI',imei);
    doc.setFontSize(8);
    row('Sale type',type);

    y+=1;doc.line(6,y,74,y);y+=6;
    doc.setFont('helvetica','bold');doc.setFontSize(11);
    doc.text('TOTAL',6,y);
    doc.text(total,74,y,{align:'right'});
    y+=9;

    doc.setDrawColor(0,158,120);doc.setLineWidth(0.6);
    doc.circle(40,y+8,9);
    doc.setFont('helvetica','bold');doc.setFontSize(6);
    doc.setTextColor(0,158,120);
    doc.text('MONALISA',40,y+6,{align:'center'});
    doc.text('TECH',40,y+8.5,{align:'center'});
    doc.text('SOLUTIONS',40,y+11,{align:'center'});
    doc.setTextColor(0);
    y+=20;
    doc.setFont('helvetica','normal');doc.setFontSize(7);
    doc.text('Thank you for choosing us.',40,y,{align:'center'});

    doc.save(nr.replace('RECEIPT #','')+'.pdf');
    toast('Receipt downloaded as PDF');
    fbLogAction('RECEIPT_PDF',currentUser.name+' downloaded a PDF receipt: '+nr);
  }catch(e){
    console.error(e);
    toast('Could not generate the PDF. Try again.','var(--red)');
  }
}

function sendReceiptWA(){
  const nr=document.getElementById('r-nr').textContent;
  const cust=document.getElementById('r-cust').textContent;
  const phone=document.getElementById('r-phone').textContent;
  const brand=document.getElementById('r-brand').textContent;
  const model=document.getElementById('r-model').textContent;
  const imei=document.getElementById('r-imei').textContent;
  const total=document.getElementById('r-total').textContent;
  const agent=document.getElementById('r-agent').textContent;
  const msg=`New sale recorded — ${nr}\n\nCustomer: ${cust} (${phone})\nDevice: ${brand} ${model}\nIMEI: ${imei}\nAmount: ${total}\nSold by: ${agent}\n\nMonalisa Tech Solutions`;
  openWA(msg);
  toast('Opening WhatsApp with receipt...');
}
function sendReceiptEmail(){
  const nr=document.getElementById('r-nr').textContent;
  const cust=document.getElementById('r-cust').textContent;
  const phone=document.getElementById('r-phone').textContent;
  const brand=document.getElementById('r-brand').textContent;
  const model=document.getElementById('r-model').textContent;
  const imei=document.getElementById('r-imei').textContent;
  const total=document.getElementById('r-total').textContent;
  const agent=document.getElementById('r-agent').textContent;
  const body=`Receipt: ${nr}\n\nCustomer: ${cust}\nPhone: ${phone}\nDevice: ${brand} ${model}\nIMEI: ${imei}\nAmount: ${total}\nSold by: ${agent}\n\nMonalisa Tech Solutions, Kampala, Uganda`;
  openMail('Receipt '+nr,body);
  toast('Opening your email app...');
}
function alertRecoveryWA(model,imei,holder,days){
  const msg=`Recovery alert\n\nDevice: ${model}\nIMEI: ${imei}\nCurrently with: ${holder}\nDays in field: ${days}\n\nThis unit needs attention. Sent from Monalisa Stock ERP.`;
  openWA(msg);
  toast('Opening WhatsApp...');
}
function emailReport(reportName){
  openMail(reportName+' — Monalisa Stock ERP','Hello Monalisa,\n\nPlease find attached the '+reportName.toLowerCase()+' for your review.\n\n(In the live system this would include the generated PDF as an attachment.)\n\nRegards,\nMonalisa Stock ERP');
  toast('Opening your email app...');
}
function shareNewUserWA(){
  const name=document.getElementById('nuName').value||'New user';
  const email=document.getElementById('nuEmail').value||'their email';
  const role=roleLabels[document.getElementById('nuRole').value]||document.getElementById('nuRole').value;
  const pass=document.getElementById('nuPass').value||'(set a password first)';
  const msg=`Welcome to Monalisa Stock ERP\n\nHello ${name}, your account has been created.\n\nRole: ${role}\nLogin email: ${email}\nTemporary password: ${pass}\n\nPlease sign in and consider changing your password.`;
  openWA(msg);
  toast('Opening WhatsApp to send credentials...');
}

// ======================================================
// DEVICE DATA
// ======================================================
// NOTE: holderUid is the real Firebase user ID of whoever currently holds
// this device. Seed/demo rows below use empty string since the demo
// holders aren't real accounts. Any device added or allocated through
// the app from now on will have a real holderUid set automatically,
// which is what territory scoping checks against.
const devices=[
  {brand:'Samsung',model:'Galaxy A55 5G',ram:'8GB',storage:'128GB',color:'Awesome Blue',imei:'357123459871234',buy:980000,sell:1250000,holder:'Agent Nalwoga',holderUid:'',loc:'Kamwokya, Kampala',age:32,status:'allocated'},
  {brand:'Tecno',model:'Camon 30 Pro',ram:'12GB',storage:'256GB',color:'Black',imei:'352987650123456',buy:680000,sell:895000,holder:'Manager Kato Peter',holderUid:'',loc:'Kampala Central',age:3,status:'allocated'},
  {brand:'Infinix',model:'Note 40 Pro 5G',ram:'8GB',storage:'256GB',color:'Gold',imei:'359001234567890',buy:590000,sell:780000,holder:'TL Ssali Moses',holderUid:'',loc:'Gulu North',age:18,status:'allocated'},
  {brand:'Itel',model:'A70 Pro',ram:'4GB',storage:'64GB',color:'Purple',imei:'356789012345678',buy:240000,sell:320000,holder:'Agent Apio Grace',holderUid:'',loc:'Gulu',age:5,status:'allocated'},
  {brand:'Redmi',model:'Note 13 Pro 5G',ram:'8GB',storage:'256GB',color:'Ocean Teal',imei:'354123456789012',buy:740000,sell:950000,holder:'CEO Stock',holderUid:'',loc:'CEO Warehouse',age:7,status:'ceo'},
  {brand:'Nokia',model:'G60 5G',ram:'6GB',storage:'128GB',color:'Black',imei:'351234567890123',buy:560000,sell:720000,holder:'Shop Kibira',holderUid:'',loc:'Entebbe Road',age:15,status:'allocated'},
  {brand:'Oppo',model:'A78 5G',ram:'8GB',storage:'128GB',color:'Glowing Black',imei:'358901234567890',buy:640000,sell:850000,holder:'Agent Nakato Sarah',holderUid:'',loc:'Jinja',age:2,status:'allocated'},
  {brand:'Vivo',model:'Y36 5G',ram:'8GB',storage:'128GB',color:'Meteorite Black',imei:'355678901234567',buy:610000,sell:780000,holder:'Agent Ssempijja',holderUid:'',loc:'Mbarara',age:24,status:'allocated'},
  {brand:'Samsung',model:'Galaxy A15',ram:'4GB',storage:'128GB',color:'Light Blue',imei:'358001234567890',buy:420000,sell:580000,holder:'CEO Stock',holderUid:'',loc:'CEO Warehouse',age:9,status:'ceo'},
  {brand:'Huawei',model:'Nova 12 SE',ram:'8GB',storage:'256GB',color:'Green',imei:'356001234567890',buy:710000,sell:920000,holder:'CEO Stock',holderUid:'',loc:'CEO Warehouse',age:4,status:'ceo'},
  {brand:'Tecno',model:'Spark 20 Pro',ram:'8GB',storage:'128GB',color:'Magic Skin White',imei:'352001234567890',buy:370000,sell:485000,holder:'Agent Apio Grace',holderUid:'',loc:'Gulu',age:6,status:'allocated'},
  {brand:'Itel',model:'P55 Plus',ram:'4GB',storage:'64GB',color:'Diamond Black',imei:'359112233445566',buy:210000,sell:285000,holder:'CEO Stock',holderUid:'',loc:'CEO Warehouse',age:11,status:'ceo'},
];

// NOTE: agentUid is the real Firebase user ID of the agent who serves
// this customer. Seed/demo rows use empty string; any customer added
// through the app from now on gets the real logged-in user's uid set
// automatically, which is what territory scoping checks against.
const customers=[
  {name:'Mukasa David',phone:'+256 772 345 678',nid:'CM98765432BC',district:'Kampala',village:'Kamwokya',agent:'Apio Grace',agentUid:'',purchases:2,last:'18 Jun 2025'},
  {name:'Namulondo Joyce',phone:'+256 701 234 567',nid:'NJ72345678AB',district:'Wakiso',village:'Nansana',agent:'Mukasa Ronald',agentUid:'',purchases:1,last:'18 Jun 2025'},
  {name:'Ssekandi Fred',phone:'+256 782 901 234',nid:'SF61238976CD',district:'Jinja',village:'Mpumudde',agent:'Nakato Sarah',agentUid:'',purchases:3,last:'18 Jun 2025'},
  {name:'Kiggundu Bashir',phone:'+256 756 123 890',nid:'KB55123456EF',district:'Kampala',village:'Bwaise',agent:'Otim Charles',agentUid:'',purchases:1,last:'18 Jun 2025'},
  {name:'Nalwanga Rose',phone:'+256 714 567 890',nid:'NR44987654GH',district:'Mbarara',village:'Kakiika',agent:'Namukasa Lydia',agentUid:'',purchases:2,last:'17 Jun 2025'},
  {name:'Byaruhanga Tom',phone:'+256 700 456 789',nid:'BT38765432IJ',district:'Gulu',village:'Layibi',agent:'Apio Grace',agentUid:'',purchases:4,last:'16 Jun 2025'},
];

// usersList is now populated live from Firebase (see fbUsers listener below).
// It starts empty and fills in once the database responds.
let usersList=[];

// ======================================================
// AGING POLICY — set per company by the CEO, separately for field
// staff (Agent/Team Leader/Manager) and Shop Owners
// ======================================================
let agingPolicy={
  field:{good:9,warn:20},
  shop:{good:14,warn:30}
};

function loadAgingPolicy(){
  if(!currentUser||!currentUser.companyId)return Promise.resolve();
  return fbDb.ref('companies/'+currentUser.companyId+'/settings/agingPolicy').once('value').then(snap=>{
    const v=snap.val();
    if(v){
      agingPolicy.field=v.field||agingPolicy.field;
      agingPolicy.shop=v.shop||agingPolicy.shop;
    }
  });
}
function saveAgingPolicy(which){
  if(!currentUser.companyId)return;
  const good=parseInt(document.getElementById(which==='field'?'ageGoodField':'ageGoodShop').value)||1;
  const warn=parseInt(document.getElementById(which==='field'?'ageWarnField':'ageWarnShop').value)||good+1;
  if(warn<=good){
    toast('The warning cutoff must be greater than the good cutoff','var(--red)');
    return;
  }
  agingPolicy[which]={good,warn};
  fbDb.ref('companies/'+currentUser.companyId+'/settings/agingPolicy/'+which).set({good,warn}).then(()=>{
    toast((which==='field'?'Field staff':'Shop owner')+' aging policy saved');
    fbLogAction('SETTINGS_UPDATED',currentUser.name+' updated the '+which+' aging policy ('+good+'/'+warn+' days)');
    renderGrid(visibleDevices());renderTable(visibleDevices());
    if(document.getElementById('pg-recovery')?.classList.contains('on'))renderRecoveryQueue();
  }).catch(()=>toast('Could not save — check your permissions','var(--red)'));
}
// which policy applies to a given device depends on who currently
// holds it — Shop Owners get their own separate policy
function policyForDevice(d){
  if(!d.holderUid)return agingPolicy.field;
  const holder=usersList.find(u=>u.uid===d.holderUid);
  return (holder&&holder.role==='shopowner')?agingPolicy.shop:agingPolicy.field;
}
function ageClass(d){const p=policyForDevice(d);return d.age<=p.good?'age-g':d.age<=p.warn?'age-a':'age-r'}
function ageBadge(d){const p=policyForDevice(d);return d.age<=p.good?'b-g':d.age<=p.warn?'b-a':'b-r'}
function ageWord(d){const p=policyForDevice(d);return d.age<=p.good?'Good':d.age<=p.warn?'Watch':'Aged'}
function isInRecoveryPhase(d){const p=policyForDevice(d);return d.age>p.warn&&d.status!=='sold'&&d.status!=='recovered'}

function renderGrid(list){
  const g=document.getElementById('deviceGrid');if(!g)return;
  g.innerHTML=list.map(d=>`
    <div class="dcard" onclick="openDetail('${d.brand} ${d.model}','${d.imei}','${d.holder}','${d.age}','${d.loc}')">
      <div class="dcard-top"><div class="dcard-icon">📱</div><span class="age ${ageClass(d)}">${d.age}d</span></div>
      <div class="dcard-brand">${d.brand}</div>
      <div class="dcard-model">${d.model}</div>
      <div class="dcard-specs"><span class="chip">${d.ram}</span><span class="chip">${d.storage}</span><span class="chip">${d.color}</span></div>
      <div class="dcard-foot"><div class="dcard-price">UGX ${d.sell.toLocaleString()}</div></div>
      <div class="dcard-holder">With: ${d.holder}</div>
    </div>`).join('');
}
function renderTable(list){
  const tb=document.getElementById('invTbody');if(!tb)return;
  tb.innerHTML=list.map(d=>`
    <tr style="cursor:pointer" onclick="openDetail('${d.brand} ${d.model}','${d.imei}','${d.holder}','${d.age}','${d.loc}')">
      <td class="mono">${d.imei}</td>
      <td><span class="bold">${d.brand}</span><br><span class="xs muted">${d.model}</span></td>
      <td>${d.ram} / ${d.storage}</td>
      <td>UGX ${d.buy.toLocaleString()}</td>
      <td class="bold">UGX ${d.sell.toLocaleString()}</td>
      <td>${d.holder}</td>
      <td><span class="age ${ageClass(d)}">${d.age}d</span></td>
      <td><span class="badge ${ageBadge(d)}">${ageWord(d)}</span></td>
    </tr>`).join('');
}
function filterInv(){
  const b=document.getElementById('invBrand').value;
  const a=document.getElementById('invAge').value;
  let l=visibleDevices();
  if(b)l=l.filter(d=>d.brand===b);
  if(a==='g')l=l.filter(d=>d.age<=9);
  else if(a==='a')l=l.filter(d=>d.age>=10&&d.age<=20);
  else if(a==='r')l=l.filter(d=>d.age>20);
  renderGrid(l);renderTable(l);
}
function filterStatus(s){
  let l=visibleDevices();
  if(s==='ceo')l=l.filter(d=>d.status==='ceo');
  else if(s==='allocated')l=l.filter(d=>d.status==='allocated');
  else if(s==='aged')l=l.filter(d=>d.age>20);
  renderGrid(l);renderTable(l);
}

function renderCustomers(list){
  const tb=document.getElementById('custTbody');if(!tb)return;
  tb.innerHTML=list.map(c=>`
    <tr>
      <td class="bold">${c.name}</td><td>${c.phone}</td><td class="mono">${c.nid}</td><td>${c.district}</td><td>${c.village}</td><td>${c.agent}</td>
      <td><span class="badge b-b">${c.purchases}</span></td><td>${c.last}</td>
      <td><button class="btn btn-wa btn-sm" onclick="openWA('Hello ${c.name}, this is Monalisa Tech Solutions following up on your purchase. ')"><i class="fab fa-whatsapp"></i></button></td>
    </tr>`).join('');
}
function filterCustomers(){
  const q=(document.getElementById('custSearch').value||'').toLowerCase();
  const d=document.getElementById('custDistrict').value;
  let l=visibleCustomers();
  if(q)l=l.filter(c=>c.name.toLowerCase().includes(q)||c.phone.includes(q)||c.nid.toLowerCase().includes(q));
  if(d)l=l.filter(c=>c.district===d);
  renderCustomers(l);
}

function renderUsersFromDb(){
  if(!fbDb)return;
  fbDb.ref('users').on('value',snap=>{
    const val=snap.val()||{};
    usersList=Object.keys(val).map(uid=>({uid,...val[uid]}));
    if(document.getElementById('pg-users')?.classList.contains('on')){
      renderUsers('');
    }
    if(document.getElementById('pg-dashboard')?.classList.contains('on')){
      renderDashboard();
    }
  });
}

function renderUsers(roleFilter){
  const tb=document.getElementById('usersTbody');if(!tb)return;
  const visible=getVisibleUsers();
  let l=visible;
  if(roleFilter)l=l.filter(u=>u.role===roleFilter);
  const canManage=currentUser&&currentUser.role==='ceo';

  // stat counters only make sense company-wide, so only show real numbers
  // to CEO/Admin; everyone else sees their own scoped count instead
  const setStat=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val};
  const isWideView=currentUser&&(currentUser.role==='ceo'||currentUser.role==='admin');
  setStat('statTotalUsers',isWideView?visible.length:visible.length);
  setStat('statAdmins',isWideView?visible.filter(u=>u.role==='admin').length:'—');
  setStat('statManagers',isWideView?visible.filter(u=>u.role==='manager').length:'—');
  setStat('statTLs',visible.filter(u=>u.role==='teamleader').length);
  setStat('statAgents',visible.filter(u=>u.role==='agent').length);
  setStat('statShops',isWideView?visible.filter(u=>u.role==='shopowner').length:'—');

  const ceoTotal=document.getElementById('ceoStatTotalUsers');
  if(ceoTotal)ceoTotal.textContent=currentUser&&currentUser.role==='ceo'?usersList.length:visible.length;

  const adminsListEl=document.getElementById('ceoAdminsList');
  if(adminsListEl){
    if(currentUser&&currentUser.role==='ceo'){
      const admins=usersList.filter(u=>u.role==='admin');
      adminsListEl.innerHTML=admins.length?admins.map(a=>`
        <div class="row card-sm" style="justify-content:space-between">
          <div class="row"><div class="ava ava-p" style="width:34px;height:34px;font-size:12px">${initials(a.name)}</div><div><div class="bold sm">${a.name}</div><div class="xs muted">${a.district||'Uganda'}</div></div></div>
          <span class="badge ${a.status==='Active'?'b-g':'b-a'}">${a.status||'Active'}</span>
        </div>`).join(''):'<div class="xs muted">No administrators yet. Use "Add admin" to create one.</div>';
    }else{
      adminsListEl.innerHTML='<div class="xs muted">Administrator details are visible to the CEO only.</div>';
    }
  }

  if(l.length===0){
    tb.innerHTML='<tr><td colspan="8" class="xs muted" style="text-align:center;padding:20px">No users visible to you yet.</td></tr>';
    return;
  }
  tb.innerHTML=l.map(u=>{
    const label=roleLabels[u.role]||u.role;
    const roleBadgeClass=u.role==='admin'?'b-v':u.role==='manager'?'b-b':u.role==='teamleader'?'b-v':u.role==='recovery'?'b-r':'b-g';
    const statusBadge=u.status==='Active'?'b-g':'b-a';
    const isSelf=currentUser&&u.uid===currentUser.uid;
    let actionCell='<span class="xs muted">View only</span>';
    if(canManage&&!isSelf){
      actionCell=u.status==='Active'
        ?`<button class="btn btn-danger btn-sm" onclick="suspendUser('${u.uid}','${u.name.replace(/'/g,"")}')">Suspend</button>`
        :`<button class="btn btn-g btn-sm" onclick="reactivateUser('${u.uid}','${u.name.replace(/'/g,"")}')">Reactivate</button>`;
    }else if(isSelf){
      actionCell='<span class="xs muted">This is you</span>';
    }
    return `<tr>
      <td class="bold">${u.name}</td>
      <td><span class="badge ${roleBadgeClass}">${label}</span></td>
      <td>${u.phone||'—'}</td><td>${u.district||'—'}</td><td>${resolveReportsTo(u.reportsTo)}</td><td>${u.joined||'—'}</td>
      <td><span class="badge ${statusBadge}">${u.status||'Active'}</span></td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');
}
function filterUsers(role){renderUsers(role)}

function suspendUser(uid,name){
  if(!confirm('Suspend '+name+'? They will not be able to log in until reactivated.'))return;
  fbDb.ref('users/'+uid+'/status').set('Suspended').then(()=>{
    toast(name+' has been suspended');
    fbLogAction('USER_SUSPENDED',currentUser.name+' suspended '+name);
  });
}
function reactivateUser(uid,name){
  fbDb.ref('users/'+uid+'/status').set('Active').then(()=>{
    toast(name+' has been reactivated');
    fbLogAction('USER_REACTIVATED',currentUser.name+' reactivated '+name);
  });
}

// ======================================================
// DEVICE DETAIL PANEL
// ======================================================
function openDetail(model,imei,holder,age,loc){
  document.getElementById('dp-title').textContent=model;
  const ac=parseInt(age)>20?'age-r':parseInt(age)>9?'age-a':'age-g';
  const canReallocate=currentUser&&perms[currentUser.role].allocateTo.length>0;
  document.getElementById('dp-body').innerHTML=`
    <div style="text-align:center;background:var(--card2);border-radius:10px;padding:24px;margin-bottom:16px">
      <div style="font-size:56px;margin-bottom:8px">📱</div>
      <div class="bold" style="font-size:17px">${model}</div>
      <div class="xs muted mt4" style="font-family:monospace">${imei}</div>
      <span class="age ${ac} mt8" style="display:inline-flex;margin-top:8px">${age} days in field</span>
    </div>
    <div class="card-sm mb12">
      <div class="hd2">Current location</div>
      <div class="row mb8"><i class="fas fa-user green"></i><span class="bold">${holder}</span></div>
      <div class="row"><i class="fas fa-map-marker-alt muted"></i><span class="xs muted">${loc}</span></div>
    </div>
    <div class="card-sm mb12">
      <div class="hd2">Movement history</div>
      <div class="tl">
        <div class="tl-item"><div class="tl-dot" style="background:var(--green)"></div><div class="tl-when">15 May 2025</div><div class="tl-what">Added to CEO stock</div><div class="tl-who">Stock intake from supplier</div></div>
        <div class="tl-item"><div class="tl-dot" style="background:var(--blue)"></div><div class="tl-when">20 May 2025</div><div class="tl-what">CEO to Manager Kato Peter</div><div class="tl-who">Allocation, confirmed both sides</div></div>
        <div class="tl-item"><div class="tl-dot" style="background:var(--blue)"></div><div class="tl-when">22 May 2025</div><div class="tl-what">Manager to TL Ssali Moses</div><div class="tl-who">Team allocation</div></div>
        <div class="tl-item"><div class="tl-dot" style="background:${parseInt(age)>20?'var(--red)':'var(--amber)'}"></div><div class="tl-when">25 May 2025</div><div class="tl-what">TL to ${holder}</div><div class="tl-who">${parseInt(age)>20?'Field — AGED, recovery triggered':'Field assignment — in progress'}</div></div>
      </div>
    </div>
    <div class="row">
      ${canReallocate?`<button class="btn btn-g btn-sm" onclick="toast('Allocation form opened');closeDetail();openM('mAllocate')">Reallocate</button>`:`<button class="btn btn-ghost btn-sm" disabled title="Your role cannot reallocate stock">Reallocate (no permission)</button>`}
      <button class="btn btn-danger btn-sm" onclick="toast('Recovery case created','var(--red)');closeDetail()">Start recovery</button>
      <button class="btn btn-wa btn-sm" onclick="openWA('Device check: ${model}, IMEI ${imei}, currently with ${holder}, ${age} days in field.')"><i class="fab fa-whatsapp"></i></button>
    </div>`;
  document.getElementById('dOverlay').classList.add('open');
  document.getElementById('dPanel').classList.add('open');
}
function closeDetail(){
  document.getElementById('dOverlay').classList.remove('open');
  document.getElementById('dPanel').classList.remove('open');
}

// ======================================================
// SEARCH
// ======================================================
const sData=[
  {tag:'IMEI',title:'357123459871234',sub:'Samsung Galaxy A55 5G, Agent Nalwoga, 32 days',fn:()=>openDetail('Samsung Galaxy A55 5G','357123459871234','Agent Nalwoga','32','Kampala')},
  {tag:'IMEI',title:'352987650123456',sub:'Tecno Camon 30 Pro, Manager Kato, 3 days',fn:()=>openDetail('Tecno Camon 30 Pro','352987650123456','Manager Kato',3,'Kampala')},
  {tag:'Customer',title:'Mukasa David',sub:'Kamwokya, Kampala, Agent Apio Grace',fn:()=>go('customers')},
  {tag:'Customer',title:'Namulondo Joyce',sub:'Nansana, Wakiso',fn:()=>go('customers')},
  {tag:'Receipt',title:'RCP-20250618-0047',sub:'Tecno Spark 20 Pro, UGX 485,000, Watu Credit',fn:()=>go('sales')},
  {tag:'Agent',title:'Apio Grace',sub:'Gulu, TL Ssali Moses, 24 units sold',fn:()=>go('performance')},
  {tag:'Recovery',title:'Vivo Y36 5G',sub:'Agent Ssempijja, Mbarara, 24 days',fn:()=>go('recovery')},
  {tag:'Manager',title:'Kato Peter',sub:'Kampala, 124 units, UGX 98.4M',fn:()=>go('performance')},
  {tag:'Admin',title:'Namugga Sarah',sub:'Operations Administrator, Kampala HQ',fn:()=>go('users')},
];
function doSearch(q){
  const p=document.getElementById('searchPanel');
  if(!q){p.classList.remove('open');return}
  const r=sData.filter(d=>d.title.toLowerCase().includes(q.toLowerCase())||d.sub.toLowerCase().includes(q.toLowerCase()));
  if(!r.length){p.innerHTML='<div style="padding:14px;text-align:center;color:var(--muted);font-size:12.5px">Nothing found for "'+q+'"</div>';p.classList.add('open');return}
  p.innerHTML=r.slice(0,6).map(x=>`<div class="sr" onclick="sData.find(d=>d.title==='${x.title}').fn();hideSP()"><div class="sr-tag">${x.tag}</div><div class="sr-title">${x.title}</div><div class="sr-sub">${x.sub}</div></div>`).join('');
  p.classList.add('open');
}
function showSP(){if(document.getElementById('sInput').value)document.getElementById('searchPanel').classList.add('open')}
function hideSP(){document.getElementById('searchPanel').classList.remove('open')}

// ======================================================
// ACTIONS
// ======================================================
// ======================================================
// REAL ALLOCATIONS — rendering, confirming, rejecting
// ======================================================
let allAllocations=[];

function renderPendingAllocations(){
  const wrap=document.getElementById('pendingAllocList');
  if(!wrap||!currentUser)return;
  const mine=allAllocations.filter(a=>a.toUid===currentUser.uid&&!a.confirmed&&!a.rejected);
  if(mine.length===0){
    wrap.innerHTML='<div class="card"><div class="xs muted" style="text-align:center;padding:10px 0">No pending allocations waiting for your confirmation.</div></div>';
    return;
  }
  wrap.innerHTML=mine.map(a=>`
    <div class="card" style="border-left:3px solid var(--amber)">
      <div class="between mb8"><span class="bold sm">${a.imeis.length} unit${a.imeis.length>1?'s':''} incoming</span><span class="badge b-a">Awaiting your confirmation</span></div>
      <div class="xs muted mb8">From ${a.fromName}</div>
      <div class="xs mb8" style="font-family:monospace">${a.imeis.join(', ')}</div>
      <div class="xs muted mb12">Sent ${new Date(a.sentAt).toLocaleString()}</div>
      <div class="row">
        <button class="btn btn-g btn-sm" onclick="confirmAllocation('${a.id}')">Confirm receipt</button>
        <button class="btn btn-danger btn-sm" onclick="rejectAllocation('${a.id}')">Reject</button>
      </div>
    </div>`).join('');
}

function renderRecentMovements(){
  const wrap=document.getElementById('recentMovementsList');
  if(!wrap)return;
  const relevant=allAllocations.filter(a=>currentUser.role==='ceo'||currentUser.role==='admin'||a.fromUid===currentUser.uid||a.toUid===currentUser.uid).sort((a,b)=>b.sentAt-a.sentAt).slice(0,8);
  if(relevant.length===0){
    wrap.innerHTML='<div class="xs muted">No movements yet.</div>';
    return;
  }
  wrap.innerHTML=relevant.map(a=>{
    const dot=a.confirmed?'var(--green)':a.rejected?'var(--red)':'var(--amber)';
    const statusWord=a.confirmed?'confirmed':a.rejected?'rejected':'pending confirmation';
    return `<div class="tl-item"><div class="tl-dot" style="background:${dot}"></div><div class="tl-when">${new Date(a.sentAt).toLocaleString()}</div><div class="tl-what">${a.fromName} to ${a.toName}</div><div class="tl-who">${a.imeis.length} unit(s), ${statusWord}</div></div>`;
  }).join('');
}

function confirmAllocation(allocId){
  const a=allAllocations.find(x=>x.id===allocId);
  if(!a)return;
  if(fbAllocations&&fbReady){
    fbAllocations.child(allocId).update({confirmed:true,confirmedAt:Date.now()});
  }
  // transfer real ownership: each device's holderUid becomes the confirming user
  a.imeis.forEach(imei=>{
    fbUpdateDevice(imei,{holderUid:currentUser.uid,holder:currentUser.name,status:'allocated',age:0,pendingTo:null});
  });
  toast('Allocation confirmed. Stock is now yours.');
  fbLogAction('ALLOCATION_CONFIRMED',currentUser.name+' confirmed receipt of '+a.imeis.length+' unit(s) from '+a.fromName);
  renderGrid(visibleDevices());renderTable(visibleDevices());
}
function rejectAllocation(allocId){
  const a=allAllocations.find(x=>x.id===allocId);
  if(!a)return;
  if(!confirm('Reject this allocation? The stock will be returned to the sender.'))return;
  if(fbAllocations&&fbReady){
    fbAllocations.child(allocId).update({rejected:true,rejectedAt:Date.now()});
  }
  // return devices to sender, clear in-transit state
  a.imeis.forEach(imei=>{
    fbUpdateDevice(imei,{holderUid:a.fromUid,holder:a.fromName,status:'allocated',pendingTo:null});
  });
  toast('Allocation rejected. Stock returned to sender.','var(--amber)');
  fbLogAction('ALLOCATION_REJECTED',currentUser.name+' rejected allocation from '+a.fromName);
  renderGrid(visibleDevices());renderTable(visibleDevices());
}
// ======================================================
// RECOVERY DEPARTMENT — aged stock auto-feed + reported issues
// ======================================================
let issueReports=[];

function fbWatchIssueReports(){
  if(!fbDb||!currentUser||!currentUser.companyId)return;
  fbDb.ref('issueReports/'+currentUser.companyId).on('value',snap=>{
    const val=snap.val()||{};
    issueReports=Object.keys(val).map(key=>({id:key,...val[key]}));
    if(document.getElementById('pg-recovery')?.classList.contains('on')){
      renderRecoveryQueue();
    }
  });
}

function doReportIssue(){
  const deviceImei=document.getElementById('issueDeviceSelect').value;
  const description=document.getElementById('issueDescription').value.trim();
  const photoFiles=document.getElementById('issuePhotos').files;
  const err=document.getElementById('issueErr');
  err.classList.remove('show');

  if(!deviceImei){
    document.getElementById('issueErrText').textContent='Please select which device this is about.';
    err.classList.add('show');
    return;
  }
  if(!description){
    document.getElementById('issueErrText').textContent='Please describe the issue.';
    err.classList.add('show');
    return;
  }
  const device=devices.find(d=>d.imei===deviceImei);
  if(!device){toast('Could not find that device','var(--red)');return}

  const btn=document.getElementById('issueSubmitBtn');
  btn.disabled=true;btn.textContent='Submitting...';

  const readAsBase64=file=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
  Promise.all(Array.from(photoFiles).map(readAsBase64)).then(photos=>{
    const report={
      imei:device.imei,brand:device.brand,model:device.model,
      reportedBy:currentUser.name,reportedByUid:currentUser.uid,reportedByRole:currentUser.role,
      description,photos,reportedAt:Date.now(),status:'open'
    };
    return fbDb.ref('issueReports/'+currentUser.companyId).push(report);
  }).then(()=>{
    fbUpdateDevice(deviceImei,{hasIssue:true,issueStatus:'open'});
    btn.disabled=false;btn.textContent='Submit report';
    closeM('mReportIssue');
    toast('Issue reported. Recovery has been notified.');
    fbLogAction('ISSUE_REPORTED',currentUser.name+' reported an issue with '+device.brand+' '+device.model+' ('+deviceImei+')');
  }).catch(e=>{
    btn.disabled=false;btn.textContent='Submit report';
    document.getElementById('issueErrText').textContent='Could not submit. Please try again.';
    err.classList.add('show');
  });
}

function populateIssueDeviceSelect(){
  const sel=document.getElementById('issueDeviceSelect');
  if(!sel)return;
  const mine=(currentUser.role==='ceo'||currentUser.role==='admin')
    ? devices.filter(d=>d.status!=='sold')
    : devices.filter(d=>d.holderUid===currentUser.uid&&d.status!=='sold');
  sel.innerHTML=mine.length
    ? mine.map(d=>`<option value="${d.imei}">${d.brand} ${d.model} — ${d.imei}</option>`).join('')
    : '<option value="">You have no devices to report</option>';
}

// the recovery queue is built entirely from real data — it can never
// show healthy, active stock, only what's actually aged or reported
function renderRecoveryQueue(which){
  which=which||document.querySelector('#recoveryTabs .tab.on')?.textContent.toLowerCase().includes('issue')?'issues':
        document.querySelector('#recoveryTabs .tab.on')?.textContent.toLowerCase().includes('recovered')?'done':'aged';
  const wrap=document.getElementById('recoveryQueueList');
  if(!wrap)return;

  const myCompanyDevices=devices.filter(d=>d.companyId===currentUser.companyId||!d.companyId); // tolerate legacy rows without companyId
  const aged=myCompanyDevices.filter(isInRecoveryPhase);
  const recovered=myCompanyDevices.filter(d=>d.status==='recovered');
  const openIssues=issueReports.filter(r=>r.status==='open');

  // update the stats row regardless of which tab is active
  document.getElementById('recoActiveCount').textContent=aged.length;
  const now=Date.now();
  const startOfToday=new Date();startOfToday.setHours(0,0,0,0);
  const startOfYesterday=new Date(startOfToday);startOfYesterday.setDate(startOfYesterday.getDate()-1);
  const startOfWeek=new Date(startOfToday);startOfWeek.setDate(startOfWeek.getDate()-startOfWeek.getDay());
  const startOfMonth=new Date(startOfToday.getFullYear(),startOfToday.getMonth(),1);
  const recoveredAt=d=>d.recoveredAt||0;
  document.getElementById('recoToday').textContent=recovered.filter(d=>recoveredAt(d)>=startOfToday.getTime()).length;
  document.getElementById('recoYesterday').textContent=recovered.filter(d=>recoveredAt(d)>=startOfYesterday.getTime()&&recoveredAt(d)<startOfToday.getTime()).length;
  document.getElementById('recoWeek').textContent=recovered.filter(d=>recoveredAt(d)>=startOfWeek.getTime()).length;
  document.getElementById('recoMonth').textContent=recovered.filter(d=>recoveredAt(d)>=startOfMonth.getTime()).length;

  if(which==='aged'){
    wrap.innerHTML=aged.length?aged.map(d=>`
      <div class="rcard">
        <div class="rcard-head"><div><div class="bold">${d.brand} ${d.model}</div><div class="mono mt4">${d.imei}</div></div><span class="age age-r">${d.age} days</span></div>
        <div class="rcard-meta"><span><i class="fas fa-user"></i> ${d.holder||'Unknown'}</span><span><i class="fas fa-map-marker-alt"></i> ${d.loc||'—'}</span></div>
        <div class="row"><button class="btn btn-g btn-sm" onclick="markRecoveredReal('${d.imei}')"><i class="fas fa-check"></i>Mark recovered</button><button class="btn btn-wa btn-sm" onclick="alertRecoveryWA('${d.brand} ${d.model}','${d.imei}','${d.holder}','${d.age}')"><i class="fab fa-whatsapp"></i>Alert CEO</button></div>
      </div>`).join(''):'<div class="card"><div class="xs muted" style="text-align:center;padding:16px 0">No aged stock right now — everything is within policy.</div></div>';
  }else if(which==='issues'){
    wrap.innerHTML=openIssues.length?openIssues.map(r=>`
      <div class="rcard warn">
        <div class="rcard-head"><div><div class="bold">${r.brand} ${r.model}</div><div class="mono mt4">${r.imei}</div></div><span class="badge b-a">Reported issue</span></div>
        <div class="rcard-meta"><span><i class="fas fa-user"></i> ${r.reportedBy} (${roleLabels[r.reportedByRole]||r.reportedByRole})</span><span><i class="fas fa-clock"></i> ${new Date(r.reportedAt).toLocaleString()}</span></div>
        <div class="xs mb10">${r.description}</div>
        ${r.photos&&r.photos.length?`<div class="row mb10" style="flex-wrap:wrap">${r.photos.map(p=>`<img src="${p}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border2)">`).join('')}</div>`:''}
        <div class="row"><button class="btn btn-g btn-sm" onclick="markRecoveredReal('${r.imei}',true)"><i class="fas fa-check"></i>Mark recovered</button></div>
      </div>`).join(''):'<div class="card"><div class="xs muted" style="text-align:center;padding:16px 0">No open issue reports.</div></div>';
  }else{
    wrap.innerHTML=recovered.length?recovered.slice(0,20).map(d=>`
      <div class="rcard done">
        <div class="rcard-head"><div><div class="bold">${d.brand} ${d.model}</div><div class="mono mt4">${d.imei}</div></div><span class="badge b-g">Recovered</span></div>
        <div class="xs green">Recovered ${d.recoveredAt?new Date(d.recoveredAt).toLocaleString():''} by ${d.recoveredBy||'—'}</div>
      </div>`).join(''):'<div class="card"><div class="xs muted" style="text-align:center;padding:16px 0">Nothing recovered yet.</div></div>';
  }
}

function markRecoveredReal(imei,fromIssue){
  const device=devices.find(d=>d.imei===imei);
  if(!device)return;
  // recovering a device removes it from whoever held it and returns it
  // to CEO master inventory — it stops appearing for that Agent/Manager/
  // Team Leader/Shop Owner immediately, everywhere, automatically.
  fbUpdateDevice(imei,{
    status:'recovered',holderUid:'',holder:'CEO Stock (recovered)',
    recoveredAt:Date.now(),recoveredBy:currentUser.name,age:0,hasIssue:false,issueStatus:null
  });
  if(fromIssue){
    const report=issueReports.find(r=>r.imei===imei&&r.status==='open');
    if(report)fbDb.ref('issueReports/'+currentUser.companyId+'/'+report.id).update({status:'resolved',resolvedAt:Date.now(),resolvedBy:currentUser.name});
  }
  toast('Device recovered and returned to CEO inventory.');
  fbLogAction('RECOVERY_COMPLETE',currentUser.name+' recovered '+device.brand+' '+device.model+' ('+imei+')');
  renderRecoveryQueue();
  renderGrid(visibleDevices());renderTable(visibleDevices());
}

// ======================================================
// COMMISSIONS PAGE — real data, scoped by who's allowed to see whom
// ======================================================
let allCommissions=[];
function loadCommissionsPage(){
  if(!currentUser||!currentUser.companyId)return;
  fbDb.ref('commissions/'+currentUser.companyId).on('value',snap=>{
    const val=snap.val()||{};
    allCommissions=Object.keys(val).map(key=>({id:key,...val[key]}));
    if(document.getElementById('pg-commissions')?.classList.contains('on')){
      renderCommissions('all');
    }
  });
}
function myVisibleCommissions(){
  if(currentUser.role==='ceo'||currentUser.role==='admin')return allCommissions;
  const visibleUids=new Set(getVisibleUsers().map(u=>u.uid));
  visibleUids.add(currentUser.uid);
  return allCommissions.filter(c=>visibleUids.has(c.uid));
}
function renderCommissions(filter){
  const list=myVisibleCommissions().filter(c=>filter==='all'||c.kind===filter).sort((a,b)=>b.createdAt-a.createdAt);
  const tb=document.getElementById('commissionsTbody');
  const total=list.reduce((s,c)=>s+c.amount,0);
  const pending=list.filter(c=>c.status==='pending').reduce((s,c)=>s+c.amount,0);
  const paid=list.filter(c=>c.status==='paid').reduce((s,c)=>s+c.amount,0);
  document.getElementById('commTotalEarned').textContent='UGX '+(total/1000).toFixed(0)+'K';
  document.getElementById('commPending').textContent='UGX '+(pending/1000).toFixed(0)+'K';
  document.getElementById('commPaid').textContent='UGX '+(paid/1000).toFixed(0)+'K';
  document.getElementById('commCount').textContent=list.length;

  const canMarkPaid=currentUser.role==='ceo'||currentUser.role==='admin';
  tb.innerHTML=list.length?list.map(c=>`
    <tr>
      <td class="bold">${c.name}</td>
      <td><span class="badge b-b">${roleLabels[c.role]||c.role}</span></td>
      <td>${c.deviceBrand} ${c.deviceModel}</td>
      <td><span class="badge ${c.kind==='direct'?'b-g':c.kind==='cumulative'?'b-v':'b-a'}">${c.kind}${c.fromSaleBy?' (from '+c.fromSaleBy+')':''}</span></td>
      <td class="bold green">${c.amount.toLocaleString()}</td>
      <td class="xs muted">${new Date(c.createdAt).toLocaleDateString()}</td>
      <td><span class="badge ${c.status==='paid'?'b-g':'b-a'}">${c.status}</span></td>
      <td>${canMarkPaid&&c.status==='pending'?`<button class="btn btn-g btn-sm" onclick="markCommissionPaid('${c.id}')">Mark paid</button>`:''}</td>
    </tr>`).join(''):'<tr><td colspan="8" class="xs muted" style="text-align:center;padding:20px">No commissions recorded yet.</td></tr>';
}
function markCommissionPaid(id){
  fbDb.ref('commissions/'+currentUser.companyId+'/'+id).update({status:'paid',paidAt:Date.now(),paidBy:currentUser.name}).then(()=>{
    toast('Commission marked as paid');
    fbLogAction('COMMISSION_PAID',currentUser.name+' marked a commission as paid');
  }).catch(()=>toast('Could not update — check your permissions','var(--red)'));
}

function doCreateUser(){
  const name=document.getElementById('nuName').value.trim();
  const email=document.getElementById('nuEmail').value.trim();
  const pass=document.getElementById('nuPass').value.trim();
  const roleVal=document.getElementById('nuRole').value;
  const age=document.getElementById('nuAge').value.trim();
  const reportsToUid=document.getElementById('nuReportsTo').value;
  const phone=document.getElementById('nuPhone').value.trim();
  const country=document.getElementById('nuCountry').value.trim();
  const region=document.getElementById('nuRegion').value.trim();
  const district=document.getElementById('nuDistrict').value.trim();
  const subCounty=document.getElementById('nuSubCounty').value.trim();
  const parish=document.getElementById('nuParish').value.trim();
  const village=document.getElementById('nuVillage').value.trim();
  const idFrontFile=document.getElementById('nuIdFront').files[0];
  const idBackFile=document.getElementById('nuIdBack').files[0];
  const err=document.getElementById('createUserErr');
  const btn=document.getElementById('createUserSubmitBtn');
  err.classList.remove('show');

  if(!name||!email||!pass){
    document.getElementById('createUserErrText').textContent='Please fill in name, email and a password.';
    err.classList.add('show');
    return;
  }
  if(pass.length<6){
    document.getElementById('createUserErrText').textContent='Password must be at least 6 characters.';
    err.classList.add('show');
    return;
  }
  if(!age||parseInt(age)<18){
    document.getElementById('createUserErrText').textContent='Age is required and must be 18 or older.';
    err.classList.add('show');
    return;
  }
  if(!reportsToUid){
    document.getElementById('createUserErrText').textContent='Please choose who this person reports to.';
    err.classList.add('show');
    return;
  }
  const allowedRoles={
    ceo:['admin','regionalmanager','manager','teamleader','agent','shopowner','recovery'],
    admin:['manager','teamleader','agent','shopowner','recovery'],
    regionalmanager:['manager'],
    manager:['agent'],
    teamleader:['agent'],
  };
  if(!(allowedRoles[currentUser.role]||[]).includes(roleVal)){
    document.getElementById('createUserErrText').textContent='Your role cannot create a login of that type.';
    err.classList.add('show');
    return;
  }

  // Team name: Managers and Team Leaders get an explicit name typed in
  // by whoever creates them. Agents and Shop Owners never type one —
  // they automatically inherit the team name of whoever they report to,
  // so there's no possibility of overlap or mismatch.
  let teamName=null;
  if(roleVal==='manager'||roleVal==='teamleader'){
    teamName=document.getElementById('nuTeamName').value.trim();
    if(!teamName){
      document.getElementById('createUserErrText').textContent='Please give this '+(roleVal==='manager'?'Manager':'Team Leader')+' a team name.';
      err.classList.add('show');
      return;
    }
  }else if(roleVal==='agent'){
    const boss=usersList.find(u=>u.uid===reportsToUid);
    teamName=boss?(boss.teamName||null):null;
  }

  const assignedRegion=document.getElementById('nuAssignedRegion')?.value||null;
  const monthlyPay=document.getElementById('nuMonthlyPay')?.value||null;
  const contractNotes=document.getElementById('nuContractNotes')?.value.trim()||null;

  btn.disabled=true;
  btn.textContent='Creating...';

  // National ID photos: read as base64 and store directly in the
  // database record. This keeps everything working without adding a
  // separate file-storage integration for now. Honest limitation: this
  // is fine for occasional ID photos at this scale, but isn't the
  // long-term right answer if this grows to thousands of users with
  // large images — Firebase Storage would be the proper home for that
  // once this is confirmed working end to end.
  const readAsBase64=file=>new Promise((resolve,reject)=>{
    if(!file){resolve(null);return}
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });

  Promise.all([readAsBase64(idFrontFile),readAsBase64(idBackFile)]).then(([idFrontData,idBackData])=>{
    // Use a secondary, isolated Firebase app instance so creating this
    // account does NOT sign the current CEO/Admin out of their own session.
    let secondaryApp;
    try{
      secondaryApp=firebase.apps.find(a=>a.name==='Secondary')||firebase.initializeApp(firebaseConfig,'Secondary');
    }catch(e){
      secondaryApp=firebase.app('Secondary');
    }
    const secondaryAuth=secondaryApp.auth();

    return secondaryAuth.createUserWithEmailAndPassword(email,pass).then(cred=>{
      const uid=cred.user.uid;
      return fbDb.ref('users/'+uid).set({
        name,email,role:roleVal,title:roleLabels[roleVal]||roleVal,
        reportsTo:reportsToUid,companyId:currentUser.companyId,
        age:parseInt(age),phone,
        teamName:teamName,
        assignedRegion:roleVal==='regionalmanager'?assignedRegion:null,
        monthlyPay:roleVal==='regionalmanager'?(monthlyPay?parseInt(monthlyPay):null):null,
        contractNotes:roleVal==='regionalmanager'?contractNotes:null,
        location:{country:country||'Uganda',region,district,subCounty,parish,village},
        nationalIdFront:idFrontData||null,nationalIdBack:idBackData||null,
        joined:new Date().toLocaleDateString(),status:'Active',createdAt:Date.now(),createdBy:currentUser.uid,
        lastActiveAt:Date.now()
      }).then(()=>secondaryAuth.signOut());
    });
  }).then(()=>{
    btn.disabled=false;
    btn.textContent='Create login';
    closeM('mCreateUser');
    toast('Login created for '+name+'. Share the password before it\'s forgotten.');
    fbLogAction('USER_CREATED',currentUser.name+' created a login for '+name+' as '+(roleLabels[roleVal]||roleVal));
    renderUsersFromDb();
  }).catch(e=>{
    btn.disabled=false;
    btn.textContent='Create login';
    document.getElementById('createUserErrText').textContent=friendlyAuthError(e);
    err.classList.add('show');
  });
}
function doAddDevice(){
  const brandEl=document.querySelector('#mAddDevice select');
  const modelEl=document.querySelectorAll('#mAddDevice .inp')[1];
  const imeiInputs=document.querySelectorAll('#mAddDevice input.inp');
  let imei='', model='', brand='', buy=0, sell=0, color='';
  document.querySelectorAll('#mAddDevice .fg').forEach(fg=>{
    const lbl=fg.querySelector('.lbl')?.textContent||'';
    const input=fg.querySelector('input,select');
    if(!input)return;
    if(lbl.includes('Model'))model=input.value;
    if(lbl.includes('Brand'))brand=input.value;
    if(lbl.includes('Color'))color=input.value;
    if(lbl.includes('IMEI'))imei=input.value;
    if(lbl.includes('Purchase'))buy=parseInt(input.value)||0;
    if(lbl.includes('Selling'))sell=parseInt(input.value)||0;
  });
  if(!imei||imei.length<5){
    toast('Please enter a valid IMEI','var(--red)');
    return;
  }
  if(devices.some(d=>d.imei===imei)){
    toast('That IMEI already exists in inventory','var(--red)');
    return;
  }
  const dest=document.getElementById('addDevDest').value;
  const goesToCeo=dest.includes('CEO');
  const newDevice={brand:brand||'Samsung',model:model||'New device',ram:'-',storage:'-',color:color||'-',imei,buy:buy||0,sell:sell||0,holder:goesToCeo?'CEO Stock':(currentUser.name),holderUid:goesToCeo?'':currentUser.uid,loc:goesToCeo?'CEO Warehouse':(currentUser.district||'Uganda'),age:0,status:goesToCeo?'ceo':'allocated'};
  fbAddDevice(newDevice);
  renderGrid(visibleDevices());renderTable(visibleDevices());
  closeM('mAddDevice');
  toast('Device added — '+dest);
  fbLogAction('STOCK_ADDED',brand+' '+model+' ('+imei+') added by '+currentUser.name);
}
function doAddCustomer(){
  const name=document.getElementById('custName').value.trim();
  const phone=document.getElementById('custPhone').value.trim();
  const nid=document.getElementById('custNid').value.trim();
  const district=document.getElementById('custDistrictAdd').value;
  const village=document.getElementById('custVillage').value.trim();
  if(!name||!phone){
    toast('Please enter the customer\'s name and phone number','var(--red)');
    return;
  }
  const newCustomer={name,phone,nid:nid||'—',district,village:village||'—',agent:currentUser.name,agentUid:currentUser.uid,purchases:0,last:'—'};
  fbAddCustomer(newCustomer);
  renderCustomers(visibleCustomers());
  closeM('mAddCustomer');
  toast('Customer added');
  fbLogAction('CUSTOMER_ADDED',currentUser.name+' added customer '+name);
}
// ======================================================
// COMMISSION ENGINE — fires automatically on every sale
// ======================================================
// Two kinds of payment, exactly as specified:
//  1. Direct commission: paid to whoever physically made the sale
//     (Agent, Shop Owner, or a Manager/Team Leader selling personally)
//  2. Cumulative commission: paid automatically to a Team Leader for
//     every sale made by their Agents, and to a Manager for every
//     sale made anywhere in their downline — instantly, no schedule
function brandOverrideFor(brand){
  const match=Object.values(companyBrands||{}).find(b=>b.name===brand);
  return (match&&match.fixedCommission!=null&&match.fixedCommission!=='')?parseInt(match.fixedCommission):null;
}

function processCommissionsForSale(device,salePrice){
  if(!currentUser.companyId)return;
  const rates=companySettings.commissionRates||{};
  const bonus=companySettings.bonusCommission||{enabled:false,agent:0,leader:0};
  const seller=currentUser;
  const records=[];

  // 1. DIRECT commission for whoever made the sale
  const override=brandOverrideFor(device.brand);
  let directAmount=0;
  if(seller.role==='agent'||seller.role==='shopowner'){
    directAmount=override!=null?override:(rates[seller.role]||0);
  }else if(seller.role==='manager'||seller.role==='teamleader'){
    // a Manager or Team Leader selling personally still earns the
    // same direct amount an Agent would, per your instruction that
    // they're allowed to sell and should be paid for it
    directAmount=override!=null?override:(rates.agent||0);
  }
  if(directAmount>0){
    records.push({uid:seller.uid,name:seller.name,role:seller.role,kind:'direct',amount:directAmount});
  }
  if(bonus.enabled&&bonus.agent>0&&(seller.role==='agent'||seller.role==='shopowner')){
    records.push({uid:seller.uid,name:seller.name,role:seller.role,kind:'bonus',amount:bonus.agent});
  }

  // 2. CUMULATIVE commission up the chain — find the seller's Team
  // Leader (if any) and that Team Leader's Manager (if any), and
  // credit each one automatically.
  const sellerProfile=usersList.find(u=>u.uid===seller.uid);
  let teamLeader=null,manager=null;
  if(sellerProfile){
    if(sellerProfile.role==='agent'){
      const boss=usersList.find(u=>u.uid===sellerProfile.reportsTo);
      if(boss&&boss.role==='teamleader')teamLeader=boss;
      else if(boss&&boss.role==='manager')manager=boss; // agent reporting straight to a manager, no TL in between
    }else if(sellerProfile.role==='teamleader'){
      const boss=usersList.find(u=>u.uid===sellerProfile.reportsTo);
      if(boss&&boss.role==='manager')manager=boss;
    }
    if(teamLeader&&!manager){
      const boss=usersList.find(u=>u.uid===teamLeader.reportsTo);
      if(boss&&boss.role==='manager')manager=boss;
    }
  }
  if(teamLeader&&rates.teamleaderCumulative>0){
    records.push({uid:teamLeader.uid,name:teamLeader.name,role:'teamleader',kind:'cumulative',amount:rates.teamleaderCumulative,fromSaleBy:seller.name});
    if(bonus.enabled&&bonus.leader>0){
      records.push({uid:teamLeader.uid,name:teamLeader.name,role:'teamleader',kind:'bonus',amount:bonus.leader});
    }
  }
  if(manager&&rates.managerCumulative>0){
    records.push({uid:manager.uid,name:manager.name,role:'manager',kind:'cumulative',amount:rates.managerCumulative,fromSaleBy:seller.name});
    if(bonus.enabled&&bonus.leader>0){
      records.push({uid:manager.uid,name:manager.name,role:'manager',kind:'bonus',amount:bonus.leader});
    }
  }

  records.forEach(r=>{
    fbDb.ref('commissions/'+currentUser.companyId).push({
      ...r,deviceImei:device.imei,deviceBrand:device.brand,deviceModel:device.model,
      salePrice,createdAt:Date.now(),status:'pending'
    });
  });
}

function doSale(){
  const custName=document.getElementById('saleCustName').value.trim();
  const custPhone=document.getElementById('saleCustPhone').value.trim();
  const custNid=document.getElementById('saleCustNid')?.value.trim()||'';
  const price=document.getElementById('salePrice').value.trim();
  const imei=document.getElementById('saleIMEI').value;
  const saleType=document.querySelector('input[name="st"]:checked')?.value||'cash';
  if(!custName||!custPhone){
    toast('Please enter the customer name and phone','var(--red)');
    return;
  }
  if(!price||isNaN(price)||parseInt(price)<=0){
    toast('Please enter a valid selling price','var(--red)');
    return;
  }
  if(!imei){
    toast('Select a device to sell','var(--red)');
    return;
  }
  const device=devices.find(d=>d.imei===imei);
  if(!device){
    toast('Could not find that device','var(--red)');
    return;
  }
  // mark the device as sold and remove it from active inventory views
  fbUpdateDevice(imei,{status:'sold',soldTo:custName,soldAt:Date.now(),soldPrice:parseInt(price),soldBy:currentUser.name,soldByUid:currentUser.uid});

  // calculate and record every commission this sale triggers — direct
  // commission for whoever sold it, plus cumulative commission for
  // their Team Leader and Manager, all instantly, no separate step
  processCommissionsForSale(device,parseInt(price));

  // find or create the customer, and bump their purchase count
  let cust=customers.find(c=>c.phone===custPhone);
  if(cust){
    cust.purchases=(cust.purchases||0)+1;
    cust.last=new Date().toLocaleDateString();
    if(fbCustomers&&fbReady&&cust._key)fbCustomers.child(cust._key).update({purchases:cust.purchases,last:cust.last});
  }else{
    const newCust={name:custName,phone:custPhone,nid:custNid||'—',district:currentUser.district||'Kampala',village:'—',agent:currentUser.name,agentUid:currentUser.uid,purchases:1,last:new Date().toLocaleDateString()};
    fbAddCustomer(newCust);
  }

  const receiptNr='RCP-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+Math.floor(Math.random()*9000+1000);
  loadReceiptInto(receiptNr,custName,custPhone,custNid||'—',currentUser.name,device.brand,device.model,(device.ram&&device.ram!=='-'?device.ram+' / '+device.storage:'—'),device.color||'—',imei,saleType==='finance'?'Financed sale':'Cash sale',parseInt(price));

  closeM('mNewSale');
  toast('Sale recorded for '+custName+'. Receipt generated.');
  fbLogAction('SALE',currentUser.name+' sold '+device.brand+' '+device.model+' to '+custName+' for UGX '+parseInt(price).toLocaleString());
  renderGrid(visibleDevices());renderTable(visibleDevices());
  go('sales');
}
function doSendAlloc(){
  const toUid=document.getElementById('allocTo').value;
  const toName=document.getElementById('allocTo').selectedOptions[0]?.textContent||'recipient';
  const checkedBoxes=document.querySelectorAll('#allocList input:checked');
  if(!toUid){
    toast('Choose who you are allocating to','var(--red)');
    return;
  }
  if(checkedBoxes.length===0){
    toast('Select at least one IMEI to allocate','var(--red)');
    return;
  }
  const imeis=Array.from(checkedBoxes).map(cb=>cb.value);
  const allocId='alloc_'+Date.now();
  const allocation={
    id:allocId,
    fromUid:currentUser.uid,fromName:currentUser.name,
    toUid,toName,
    imeis,
    sentAt:Date.now(),
    confirmed:false
  };
  if(fbAllocations&&fbReady){
    fbAllocations.child(allocId).set(allocation);
  }
  // mark these devices as "in transit" immediately so they don't show as
  // available to allocate again while the recipient hasn't confirmed yet
  imeis.forEach(imei=>fbUpdateDevice(imei,{status:'in_transit',pendingTo:toUid}));
  closeM('mAllocate');
  toast(checkedBoxes.length+' unit(s) sent to '+toName+'. Waiting for confirmation.');
  fbLogAction('ALLOCATION_SENT',currentUser.name+' allocated '+checkedBoxes.length+' unit(s) to '+toName);
  renderGrid(visibleDevices());renderTable(visibleDevices());
}

function loadAllocIMEI(){
  const b=document.getElementById('allocBrand').value;
  // Only show devices of this brand that the CURRENT user actually holds
  // (or, for CEO/Admin, anything in CEO master stock) — you can't allocate
  // stock you don't have.
  let mine;
  if(currentUser.role==='ceo'||currentUser.role==='admin'){
    mine=devices.filter(d=>d.brand===b&&d.status==='ceo');
  }else{
    mine=devices.filter(d=>d.brand===b&&d.holderUid===currentUser.uid);
  }
  const list=document.getElementById('allocList');
  if(mine.length===0){
    list.innerHTML='<div class="xs muted" style="padding:6px 0">You don\'t currently hold any '+b+' devices to allocate.</div>';
    return;
  }
  list.innerHTML=mine.map(d=>`<label style="display:flex;align-items:center;gap:7px;padding:4px 0;cursor:pointer;font-size:12px"><input type="checkbox" value="${d.imei}"> <span style="font-family:monospace;font-size:11px">${d.imei} — ${d.model}</span></label>`).join('');
}
function loadSaleIMEI(){
  const b=document.getElementById('saleBrand').value;
  // Only show devices of this brand that the CURRENT user actually holds —
  // you can only sell stock that's in your own hands.
  const mine=currentUser.role==='ceo'||currentUser.role==='admin'
    ? devices.filter(d=>d.brand===b)
    : devices.filter(d=>d.brand===b&&d.holderUid===currentUser.uid);
  const s=document.getElementById('saleIMEI');
  s.innerHTML=mine.length
    ? mine.map(d=>`<option value="${d.imei}">${d.imei} — ${d.model}</option>`).join('')
    : '<option value="">No devices of this brand in your hands</option>';
}
function loadReceiptInto(nr,cust,phone,nid,agent,brand,model,specs,color,imei,type,amount){
  document.getElementById('r-nr').textContent='RECEIPT #'+nr;
  document.getElementById('r-cust').textContent=cust;
  document.getElementById('r-phone').textContent=phone;
  document.getElementById('r-nid').textContent=nid;
  document.getElementById('r-agent').textContent='Agent '+agent;
  document.getElementById('r-brand').textContent=brand;
  document.getElementById('r-model').textContent=model;
  document.getElementById('r-specs').textContent=specs;
  document.getElementById('r-color').textContent=color;
  document.getElementById('r-imei').textContent=imei;
  document.getElementById('r-type').textContent=type;
  document.getElementById('r-total').textContent='UGX '+amount.toLocaleString();
  toast('Receipt loaded');
}
function simulateImport(){toast('342 records imported and matched')}

// ======================================================
// DATE / GREETING
// ======================================================
// ======================================================
// PER-ROLE DASHBOARD RENDERING
// ======================================================
function greetingText(){
  const h=new Date().getHours();
  const gr=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  return currentUser?gr+', '+currentUser.title.split(' ')[0]+' '+currentUser.name.split(' ')[0]:gr;
}
function todayLong(){
  return new Date().toLocaleDateString('en-UG',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
function heroBlock(alertHtml){
  return `<div style="background:linear-gradient(110deg,var(--card) 0%,rgba(0,200,150,.04) 60%,rgba(76,110,245,.04) 100%);border:1px solid var(--border);border-radius:14px;padding:22px;margin-bottom:18px;position:relative;overflow:hidden">
    <div style="position:absolute;top:-30px;right:-30px;width:180px;height:180px;background:radial-gradient(circle,rgba(0,200,150,.07),transparent 70%);pointer-events:none"></div>
    <div class="xs muted mb4" style="display:flex;align-items:center;gap:6px"><span class="dot-live"></span>Live overview</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:21px;font-weight:700;margin-bottom:4px">${greetingText()}</div>
    <div class="sm muted">${alertHtml}</div>
    <div style="margin-top:14px"><span style="background:var(--card2);border:1px solid var(--border);padding:5px 11px;border-radius:7px;font-size:11.5px;color:var(--muted);display:inline-flex;align-items:center;gap:5px"><i class="fas fa-calendar-alt"></i>${todayLong()}</span></div>
  </div>`;
}

function updateGreeting(){
  renderDashboard();
}

function renderDashboard(){
  const el=document.getElementById('dashboardContent');
  if(!el||!currentUser)return;
  if(currentUser.role==='superadmin'){renderSuperAdminDashboard(el);return}
  if(currentUser.role==='ceo'||currentUser.role==='admin'){renderCeoAdminDashboard(el);return}
  if(currentUser.role==='manager'){renderManagerDashboard(el);return}
  if(currentUser.role==='teamleader'){renderTeamLeaderDashboard(el);return}
  if(currentUser.role==='agent'||currentUser.role==='shopowner'){renderAgentDashboard(el);return}
  if(currentUser.role==='recovery'){renderRecoveryDashboard(el);return}
  el.innerHTML='<div class="xs muted">No dashboard configured for this role yet.</div>';
}

// ---- CEO / ADMIN: full company view ----
function renderCeoAdminDashboard(el){
  const myDevices=visibleDevices();
  const held=myDevices.filter(d=>d.status!=='sold');
  const sold=myDevices.filter(d=>d.status==='sold');
  const aged=held.filter(d=>d.age>20);
  const stockValue=held.reduce((s,d)=>s+(d.sell||0),0);
  const revenue=sold.reduce((s,d)=>s+(d.soldPrice||0),0);
  const myTeam=getVisibleUsers();

  // rank team members (excluding self) by their personal sales revenue
  const ranked=myTeam.filter(u=>u.uid!==currentUser.uid).map(u=>{
    const theirSales=devices.filter(d=>d.status==='sold'&&d.soldByUid===u.uid);
    const rev=theirSales.reduce((s,d)=>s+(d.soldPrice||0),0);
    return {name:u.name,role:u.role,rev,units:theirSales.length};
  }).filter(r=>r.units>0).sort((a,b)=>b.rev-a.rev).slice(0,5);

  el.innerHTML=`
    ${heroBlock(aged.length?`You have <span style="color:var(--amber);font-weight:600">${aged.length} aged device${aged.length>1?'s':''}</span> needing attention.`:'No aged stock right now — everything looks healthy.')}
    <div class="stats">
      <div class="stat" style="border-top:2px solid var(--green)"><div class="stat-ic ic-g"><i class="fas fa-mobile-alt"></i></div><div class="stat-lbl">Stock on hand</div><div class="stat-val" style="font-size:30px">${held.length}</div></div>
      <div class="stat" style="border-top:2px solid var(--blue)"><div class="stat-ic ic-b"><i class="fas fa-coins"></i></div><div class="stat-lbl">Stock value</div><div class="stat-val" style="font-size:21px">UGX ${(stockValue/1000000).toFixed(1)}M</div></div>
      <div class="stat" style="border-top:2px solid var(--amber);flex:1.4"><div class="stat-ic ic-a"><i class="fas fa-chart-bar"></i></div><div class="stat-lbl">Revenue, all time</div><div class="stat-val" style="font-size:26px">UGX ${(revenue/1000000).toFixed(1)}M</div><div class="xs muted mt4">${sold.length} unit(s) sold</div></div>
      <div class="stat" style="border-top:2px solid var(--red)"><div class="stat-ic ic-r"><i class="fas fa-clock"></i></div><div class="stat-lbl">Aged 21+ days</div><div class="stat-val red" style="font-size:30px">${aged.length}</div></div>
    </div>
    <div class="g2 mb16" style="grid-template-columns:2fr 3fr">
      <div class="card">
        <div class="hd2">Top performers</div>
        ${ranked.length?ranked.map((r,i)=>`<div class="rank-row"><div class="rank-n ${i===0?'r1':i===1?'r2':i===2?'r3':'r0'}">${i+1}</div><div style="flex:1"><div class="bold sm">${r.name}</div><div class="xs muted">${roleLabels[r.role]||r.role}</div></div><div style="text-align:right"><div class="bold green sm">UGX ${(r.rev/1000000).toFixed(1)}M</div><div class="xs muted">${r.units} units</div></div></div>`).join(''):'<div class="xs muted">No sales recorded yet.</div>'}
      </div>
      <div class="card">
        <div class="hd2">Aged stock</div>
        ${aged.length?`<div class="tw"><table><thead><tr><th>Device</th><th>With</th><th>Days</th></tr></thead><tbody>${aged.slice(0,6).map(d=>`<tr style="cursor:pointer" onclick="openDetail('${d.brand} ${d.model}','${d.imei}','${d.holder}','${d.age}','${d.loc}')"><td class="bold">${d.brand} ${d.model}</td><td>${d.holder}</td><td><span class="age age-r">${d.age}d</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="xs muted">Nothing aged right now.</div>'}
      </div>
    </div>`;
}

// ---- MANAGER ----
function renderManagerDashboard(el){
  const myTeam=getVisibleUsers().filter(u=>u.uid!==currentUser.uid);
  const teamLeaders=myTeam.filter(u=>u.role==='teamleader');
  const agents=myTeam.filter(u=>u.role==='agent');
  const myDownlineUids=myTeam.map(u=>u.uid);
  const myStock=devices.filter(d=>myDownlineUids.includes(d.holderUid)&&d.status!=='sold');
  const mySold=devices.filter(d=>myDownlineUids.includes(d.soldByUid)&&d.status==='sold');
  const revenue=mySold.reduce((s,d)=>s+(d.soldPrice||0),0);
  const myQuotient=teamStockQuotientFor(currentUser.uid,'manager');

  el.innerHTML=`
    ${heroBlock(`Your team's stock efficiency is <span style="color:${quotientColor(myQuotient.quotient)};font-weight:600">${myQuotient.quotient}%</span>.`)}
    <div class="stats">
      <div class="stat"><div class="stat-lbl">Team Leaders</div><div class="stat-val" style="font-size:26px">${teamLeaders.length}</div></div>
      <div class="stat"><div class="stat-lbl">Agents</div><div class="stat-val" style="font-size:26px">${agents.length}</div></div>
      <div class="stat"><div class="stat-lbl">Team stock on hand</div><div class="stat-val" style="font-size:26px">${myStock.length}</div></div>
      <div class="stat" style="flex:1.3"><div class="stat-lbl">Team revenue</div><div class="stat-val green" style="font-size:24px">UGX ${(revenue/1000000).toFixed(1)}M</div></div>
      <div class="stat" style="border-top:3px solid ${quotientColor(myQuotient.quotient)}"><div class="stat-lbl">Your efficiency score</div><div class="stat-val" style="font-size:26px;color:${quotientColor(myQuotient.quotient)}">${myQuotient.quotient}%</div></div>
    </div>
    <div class="card mb16">
      <div class="hd2">Your Team Leaders, with their stock</div>
      ${teamLeaders.length?teamLeaders.map(tl=>{
        const tlAgents=myTeam.filter(u=>u.role==='agent'&&u.reportsTo===tl.uid);
        const tlTeamUids=[tl.uid,...tlAgents.map(a=>a.uid)];
        const tlStock=devices.filter(d=>tlTeamUids.includes(d.holderUid)&&d.status!=='sold');
        const tlQ=teamStockQuotientFor(tl.uid,'teamleader');
        return `<div class="card-sm mb8"><div class="between mb6"><span class="bold sm">${tl.name}</span><span class="badge ${quotientBadgeClass(tlQ.quotient)}">${tlQ.quotient}% efficient</span></div><div class="xs muted">${tlAgents.length} agent(s), ${tlStock.length} unit(s) held</div></div>`;
      }).join(''):'<div class="xs muted">No Team Leaders yet.</div>'}
    </div>`;
}

// ---- TEAM LEADER ----
function renderTeamLeaderDashboard(el){
  const myAgents=getVisibleUsers().filter(u=>u.uid!==currentUser.uid);
  const myDownlineUids=[currentUser.uid,...myAgents.map(u=>u.uid)];
  const myStock=devices.filter(d=>myDownlineUids.includes(d.holderUid)&&d.status!=='sold');
  const mySold=devices.filter(d=>myDownlineUids.includes(d.soldByUid)&&d.status==='sold');
  const revenue=mySold.reduce((s,d)=>s+(d.soldPrice||0),0);
  const myQuotient=teamStockQuotientFor(currentUser.uid,'teamleader');
  const personalStock=devices.filter(d=>d.holderUid===currentUser.uid&&d.status!=='sold');

  el.innerHTML=`
    ${heroBlock(`Your team's stock efficiency is <span style="color:${quotientColor(myQuotient.quotient)};font-weight:600">${myQuotient.quotient}%</span>.`)}
    <div class="stats">
      <div class="stat"><div class="stat-lbl">Your agents</div><div class="stat-val" style="font-size:26px">${myAgents.length}</div></div>
      <div class="stat"><div class="stat-lbl">You personally hold</div><div class="stat-val" style="font-size:26px">${personalStock.length}</div></div>
      <div class="stat"><div class="stat-lbl">Team stock on hand</div><div class="stat-val" style="font-size:26px">${myStock.length}</div></div>
      <div class="stat" style="flex:1.3"><div class="stat-lbl">Team revenue</div><div class="stat-val green" style="font-size:24px">UGX ${(revenue/1000000).toFixed(1)}M</div></div>
      <div class="stat" style="border-top:3px solid ${quotientColor(myQuotient.quotient)}"><div class="stat-lbl">Your efficiency score</div><div class="stat-val" style="font-size:26px;color:${quotientColor(myQuotient.quotient)}">${myQuotient.quotient}%</div></div>
    </div>
    <div class="card mb16">
      <div class="between mb12"><div class="hd2" style="margin:0">Your agents, with their stock</div></div>
      ${myAgents.length?myAgents.map(a=>{
        const aQ=stockQuotientFor(a.uid);
        return `<div class="card-sm mb8"><div class="between mb6"><span class="bold sm">${a.name}</span><span class="badge ${quotientBadgeClass(aQ.quotient)}">${aQ.quotient}% efficient</span></div><div class="xs muted">${aQ.total} unit(s) held — ${aQ.green} fresh, ${aQ.orange} moderate, ${aQ.red} aged</div></div>`;
      }).join(''):'<div class="xs muted">No agents yet.</div>'}
    </div>
    <button class="btn btn-g btn-sm" onclick="go('sales')"><i class="fas fa-receipt"></i> Record a sale</button>`;
}

// ---- AGENT / SHOP OWNER ----
function renderAgentDashboard(el){
  const myStock=devices.filter(d=>d.holderUid===currentUser.uid&&d.status!=='sold');
  const mySold=devices.filter(d=>d.soldByUid===currentUser.uid&&d.status==='sold');
  const revenue=mySold.reduce((s,d)=>s+(d.soldPrice||0),0);
  const myQuotient=stockQuotientFor(currentUser.uid);

  el.innerHTML=`
    ${heroBlock(`Your personal stock efficiency is <span style="color:${quotientColor(myQuotient.quotient)};font-weight:600">${myQuotient.quotient}%</span>.`)}
    <div class="stats">
      <div class="stat"><div class="stat-lbl">Stock you hold</div><div class="stat-val" style="font-size:30px">${myStock.length}</div></div>
      <div class="stat"><div class="stat-lbl">Units sold, all time</div><div class="stat-val" style="font-size:26px">${mySold.length}</div></div>
      <div class="stat" style="flex:1.3"><div class="stat-lbl">Your revenue</div><div class="stat-val green" style="font-size:24px">UGX ${(revenue/1000000).toFixed(1)}M</div></div>
      <div class="stat" style="border-top:3px solid ${quotientColor(myQuotient.quotient)}"><div class="stat-lbl">Efficiency score</div><div class="stat-val" style="font-size:26px;color:${quotientColor(myQuotient.quotient)}">${myQuotient.quotient}%</div></div>
    </div>
    <div class="card mb16">
      <div class="between mb12"><div class="hd2" style="margin:0">Your stock right now</div><span class="xs muted">${myQuotient.green} fresh · ${myQuotient.orange} moderate · ${myQuotient.red} aged</span></div>
      ${myStock.length?`<div class="g4" style="gap:10px">${myStock.map(d=>`<div class="dcard" onclick="openDetail('${d.brand} ${d.model}','${d.imei}','${d.holder}','${d.age}','${d.loc}')"><div class="dcard-top"><div class="dcard-icon">📱</div><span class="age ${ageClass(d)}">${d.age}d</span></div><div class="dcard-brand">${d.brand}</div><div class="dcard-model">${d.model}</div><div class="dcard-price">UGX ${d.sell.toLocaleString()}</div></div>`).join('')}</div>`:'<div class="xs muted">You have no stock right now.</div>'}
    </div>
    <button class="btn btn-g btn-sm" onclick="go('sales')"><i class="fas fa-receipt"></i> Record a sale</button>`;
}

// ---- RECOVERY OFFICER ----
function renderRecoveryDashboard(el){
  el.innerHTML=`
    ${heroBlock('Here are the aged-stock cases assigned to you.')}
    <div class="card"><div class="hd2">Your assigned cases</div>
      <button class="btn btn-g btn-sm" onclick="go('recovery')">Go to Recovery Management</button>
    </div>`;
}

// ---- SUPER ADMIN: oversees every company ----
function renderSuperAdminDashboard(el){
  fbDb.ref('companies').once('value').then(snap=>{
    const companiesVal=snap.val()||{};
    const ids=Object.keys(companiesVal);
    const active=ids.filter(id=>companiesVal[id].subscription?.status==='active').length;
    const pending=ids.filter(id=>(companiesVal[id].subscription?.status||'pending')==='pending').length;
    const suspended=ids.filter(id=>companiesVal[id].subscription?.status==='suspended').length;

    el.innerHTML=`
      ${heroBlock(`You oversee <span style="color:var(--green);font-weight:600">${ids.length} compan${ids.length===1?'y':'ies'}</span> on this platform.`)}
      <div class="stats">
        <div class="stat" style="border-top:2px solid var(--green)"><div class="stat-lbl">Total companies</div><div class="stat-val" style="font-size:30px">${ids.length}</div></div>
        <div class="stat" style="border-top:2px solid var(--green)"><div class="stat-lbl">Active subscriptions</div><div class="stat-val green" style="font-size:28px">${active}</div></div>
        <div class="stat" style="border-top:2px solid var(--amber)"><div class="stat-lbl">Pending payment</div><div class="stat-val amber" style="font-size:28px">${pending}</div></div>
        <div class="stat" style="border-top:2px solid var(--red)"><div class="stat-lbl">Suspended</div><div class="stat-val red" style="font-size:28px">${suspended}</div></div>
      </div>
      <div class="card">
        <div class="between mb12"><div class="hd2" style="margin:0">All companies</div><span class="xs muted">${ids.length} of 200 capacity</span></div>
        <div class="tw"><table><thead><tr><th>Company</th><th>CEO</th><th>District</th><th>Status</th><th>Registered</th><th></th></tr></thead><tbody>
          ${ids.length?ids.map(id=>{
            const c=companiesVal[id];
            const p=c.profile||{};
            const sub=c.subscription||{status:'pending'};
            const badgeClass=sub.status==='active'?'b-g':sub.status==='suspended'?'b-r':'b-a';
            return `<tr><td class="bold">${p.businessName||'—'}</td><td>${p.ceoName||'—'}</td><td>${p.district||'—'}</td><td><span class="badge ${badgeClass}">${sub.status}</span></td><td class="xs muted">${p.registeredAt?new Date(p.registeredAt).toLocaleDateString():'—'}</td><td>${sub.status==='active'?`<button class="btn btn-danger btn-sm" onclick="setCompanySubStatus('${id}','suspended')">Suspend</button>`:`<button class="btn btn-g btn-sm" onclick="setCompanySubStatus('${id}','active')">Activate</button>`}</td></tr>`;
          }).join(''):'<tr><td colspan="6" class="xs muted" style="text-align:center;padding:16px">No companies registered yet.</td></tr>'}
        </tbody></table></div>
      </div>`;
  });
}
function setCompanySubStatus(companyId,status){
  fbDb.ref('companies/'+companyId+'/subscription').update({status,updatedAt:Date.now(),updatedBy:currentUser.name}).then(()=>{
    toast('Subscription status updated');
    renderDashboard();
  }).catch(()=>toast('Could not update — check permissions','var(--red)'));
}

// ======================================================
// UGANDA MAP
// ======================================================
function initMap(){
  const svg=document.getElementById('mapSvg');if(!svg)return;
  const tt=document.getElementById('mapTT');
  svg.querySelectorAll('path').forEach(p=>{
    p.addEventListener('mouseenter',function(){tt.style.display='block';tt.innerHTML='<strong>'+this.dataset.name+'</strong><br>'+this.dataset.val+', '+this.dataset.units+' units'});
    p.addEventListener('mousemove',function(e){
      const r=svg.parentElement.getBoundingClientRect();
      tt.style.left=(e.clientX-r.left+10)+'px';tt.style.top=(e.clientY-r.top-40)+'px';
    });
    p.addEventListener('mouseleave',()=>tt.style.display='none');
    p.addEventListener('click',function(){
      svg.querySelectorAll('path').forEach(x=>x.classList.remove('sel'));
      this.classList.toggle('sel');
      toast(this.dataset.name+': '+this.dataset.val+', '+this.dataset.units+' units');
    });
  });
}

// ======================================================
// CHARTS
// ======================================================
const CH={};
function mk(id,type,data,opts){
  const el=document.getElementById(id);if(!el)return;
  if(CH[id])CH[id].destroy();
  CH[id]=new Chart(el,{type,data,options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},...opts}});
}
const grd={color:'rgba(255,255,255,.04)'};
const tx={color:'rgba(255,255,255,.38)',font:{size:10.5}};

function buildCharts(pg){
  if(pg==='dashboard'){
    mk('cSales','line',{
      labels:['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
      datasets:[{label:'UGX M',data:[198,224,241,268,287,312,228,261,289,304,291,312],borderColor:'#00c896',fill:true,backgroundColor:'rgba(0,200,150,.07)',tension:.4,pointRadius:3,borderWidth:2,pointBackgroundColor:'#00c896'}]
    },{scales:{x:{grid:grd,ticks:tx},y:{grid:grd,ticks:tx}}});
    mk('cBrand','doughnut',{
      labels:['Tecno','Samsung','Infinix','Itel','Redmi','Others'],
      datasets:[{data:[234,198,142,89,68,116],backgroundColor:['#00c896','#4c6ef5','#f5a623','#e84545','#8b5cf6','#475569'],borderWidth:0}]
    },{cutout:'62%',plugins:{legend:{display:true,position:'bottom',labels:{color:'rgba(255,255,255,.5)',padding:6,font:{size:10},boxWidth:10}}}});
    mk('cAge','bar',{
      labels:['0 to 9 days','10 to 20 days','21+ days'],
      datasets:[{data:[620,180,47],backgroundColor:['rgba(0,200,150,.65)','rgba(245,166,35,.65)','rgba(232,69,69,.65)'],borderRadius:6,borderWidth:0}]
    },{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:grd,ticks:tx},y:{grid:{display:false},ticks:tx}}});
  }else if(pg==='ceo'){
    mk('cRegion','bar',{
      labels:['Central','Eastern','Northern','Western','Greater KLA'],
      datasets:[{data:[312,168,142,98,224],backgroundColor:'rgba(76,110,245,.65)',borderRadius:6,borderWidth:0}]
    },{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:grd,ticks:tx},y:{grid:{display:false},ticks:tx}}});
  }else if(pg==='performance'){
    mk('cPerf','line',{
      labels:['Jan','Feb','Mar','Apr','May','Jun'],
      datasets:[
        {label:'Kato Peter',data:[72,78,85,91,94,98],borderColor:'#00c896',tension:.4,fill:false,pointRadius:3,borderWidth:2},
        {label:'Nakamya Judith',data:[58,62,68,71,74,76],borderColor:'#4c6ef5',tension:.4,fill:false,pointRadius:3,borderWidth:2},
        {label:'Ssebuliba Mark',data:[44,49,52,58,61,63],borderColor:'#f5a623',tension:.4,fill:false,pointRadius:3,borderWidth:2},
        {label:'Abaasa Robert',data:[32,35,37,39,40,41],borderColor:'#8b5cf6',tension:.4,fill:false,pointRadius:3,borderWidth:2},
      ]
    },{plugins:{legend:{display:true,position:'bottom',labels:{color:'rgba(255,255,255,.5)',font:{size:10},boxWidth:10,padding:8}}},scales:{x:{grid:grd,ticks:tx},y:{grid:grd,ticks:tx}}});
  }else if(pg==='reports'){
    mk('cReports','bar',{
      labels:['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
      datasets:[
        {label:'Cash',data:[112,128,139,155,162,178,132,148,166,174,168,178],backgroundColor:'rgba(0,200,150,.65)',borderRadius:4,borderWidth:0},
        {label:'Finance',data:[86,96,102,113,125,134,96,113,123,130,123,134],backgroundColor:'rgba(76,110,245,.65)',borderRadius:4,borderWidth:0},
      ]
    },{plugins:{legend:{display:true,position:'bottom',labels:{color:'rgba(255,255,255,.5)',font:{size:10},boxWidth:10,padding:8}}},scales:{x:{grid:{display:false},ticks:tx},y:{grid:grd,ticks:tx}}});
  }else if(pg==='uganda'){
    mk('cUganda','bar',{
      labels:['Kampala','Wakiso','Gulu','Jinja','Mbale','Mbarara','Arua','Lira','Masaka','Tororo'],
      datasets:[{data:[142,84,56,44,36,30,21,16,10,14],backgroundColor:['rgba(0,200,150,.75)','rgba(0,200,150,.6)','rgba(76,110,245,.65)','rgba(76,110,245,.5)','rgba(245,166,35,.6)','rgba(245,166,35,.5)','rgba(139,92,246,.55)','rgba(139,92,246,.45)','rgba(232,69,69,.5)','rgba(232,69,69,.4)'],borderRadius:6,borderWidth:0}]
    },{plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:tx},y:{grid:grd,ticks:tx}}});
    initMap();
  }
}

// ======================================================
// KEYBOARD
// ======================================================
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    document.querySelectorAll('.mwrap').forEach(m=>m.classList.remove('open'));
    closeDetail();
    document.getElementById('notifPanel').classList.remove('open');
  }
});

// ======================================================
// BOOT
// ======================================================
function bootApp(){
  const app=document.getElementById('app');
  app.classList.add('on');
  app.style.display='flex';
  if(currentUser.role!=='superadmin'){
    connectCompanyData();
  }
  loadAgingPolicy().then(()=>{
    renderGrid(visibleDevices());
    renderTable(visibleDevices());
    if(document.getElementById('pg-recovery')?.classList.contains('on'))renderRecoveryQueue();
  });
  renderCustomers(visibleCustomers());
  renderUsersFromDb();
  loadAllocIMEI();
  fbWatchIssueReports();
  loadCommissionsPage();
  document.getElementById('nav-dashboard').classList.add('on');
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.getElementById('pg-dashboard').classList.add('on');
  document.getElementById('pageTitle').textContent='Dashboard';
  applyPermissions();
  renderDashboard();
  startSessionTimer();
  resetInactivity();
  toast('Signed in as '+currentUser.name);
  fbLogAction('LOGIN','Signed in from '+(navigator.userAgent.includes('Mobile')?'mobile device':'desktop'));
}

function hideSplashAndShowLogin(){
  const splash=document.getElementById('splash');
  if(splash){
    splash.classList.add('out');
    setTimeout(()=>{splash.style.display='none'},500);
  }
  try{
    checkFirstRun();
  }catch(e){
    console.error('checkFirstRun failed, falling back to login screen',e);
    document.getElementById('loginScreen').classList.add('on');
  }
}

window.addEventListener('load',()=>{
  // Firebase loading is wrapped so that even if the CDN scripts fail
  // entirely (slow connection, blocked request, ad blocker), the app
  // still reaches the login screen instead of freezing on the splash
  // screen forever. A failed connection will show as "Offline" in the
  // sync pill rather than a blank page.
  try{
    initFirebase();
  }catch(e){
    console.error('Firebase failed to initialize',e);
    setSyncStatus('offline');
  }
  setTimeout(hideSplashAndShowLogin,1700);
});

// Safety net: if for any reason the splash screen is still showing
// after 8 seconds (slow network, an unexpected error, etc.), force it
// away so the page is never stuck blank on a phone.
setTimeout(()=>{
  const splash=document.getElementById('splash');
  if(splash&&splash.style.display!=='none'){
    console.warn('Splash screen safety timeout triggered');
    hideSplashAndShowLogin();
  }
},8000);