// Run ONCE from a trusted computer. Never commit service-account credentials.
const {initializeApp,cert}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
(async()=>{
 const uid=process.env.ADMIN_UID,raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
 if(!uid||!raw)throw Error('ADMIN_UID and FIREBASE_SERVICE_ACCOUNT_JSON required');
 const key=JSON.parse(raw);if(key.project_id!=='ansimcare-9bae3')throw Error('Wrong Firebase project');
 initializeApp({credential:cert(key)});const auth=getAuth(),u=await auth.getUser(uid);
 if(u.email && !u.emailVerified)throw Error('Email manager must verify their address first.');
 if(!u.email && !u.uid.startsWith('kakao:'))throw Error('Unexpected admin identity');
 await auth.setCustomUserClaims(uid,{...(u.customClaims||{}),role:'admin'});
 console.log('Admin privileges assigned to UID:',uid,'— log out and log in again.');
})().catch(e=>{console.error(e.message);process.exit(1)});
