import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5";
import { layout, sendEmail } from "../_shared/templates.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const safe=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const publicLink=(token:string)=>`https://nips.com.pk/portal/faculty-interview.html?token=${encodeURIComponent(token)}`;

async function signJaas(room:string,id:string,name:string,moderator:boolean){
  const now=Math.floor(Date.now()/1000),appId=Deno.env.get("JAAS_APP_ID")!;
  const key=await importPKCS8(Deno.env.get("JAAS_PRIVATE_KEY")!,"RS256");
  const jwt=await new SignJWT({aud:"jitsi",iss:"chat",sub:appId,room,context:{user:{id,name,moderator:moderator?"true":"false"},features:{recording:"false",livestreaming:"false",transcription:"false","outbound-call":"false"}}})
    .setProtectedHeader({alg:"RS256",kid:Deno.env.get("JAAS_KID")!,typ:"JWT"}).setIssuedAt(now).setNotBefore(now-10).setExpirationTime(now+60*60*3).sign(key);
  return {jwt,appId,room,moderator,name};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const svc=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const auth=(req.headers.get("Authorization")||"").replace("Bearer ","");
    const{data:{user}}=await svc.auth.getUser(auth);
    if(!user)return json({error:"Invalid session"},401);
    const{data:admin}=await svc.from("profiles").select("full_name,role,is_active").eq("id",user.id).single();
    if(admin?.role!=="admin"||admin?.is_active===false)return json({error:"Admin access required"},403);
    const body=await req.json(),action=String(body.action||"schedule"),id=String(body.interview_id||"");

    if(action==="schedule"){
      const applicationId=String(body.application_id||""),scheduledAt=new Date(String(body.scheduled_at||""));
      const duration=Math.round(Number(body.duration_minutes||30)),interviewerId=String(body.interviewer_id||user.id);
      if(!applicationId||Number.isNaN(scheduledAt.getTime())||scheduledAt.getTime()<Date.now()-300000)return json({error:"Choose a valid future interview time."},400);
      if(duration<15||duration>180)return json({error:"Interview duration must be between 15 and 180 minutes."},400);
      const[{data:app},{data:interviewer}]=await Promise.all([
        svc.from("teacher_applications").select("*").eq("id",applicationId).single(),
        svc.from("profiles").select("id,full_name,role,is_active").eq("id",interviewerId).single()
      ]);
      if(!app||["approved","rejected"].includes(app.status))return json({error:"This application cannot be scheduled."},409);
      if(interviewer?.role!=="admin"||interviewer?.is_active===false)return json({error:"Choose an active administrator as interviewer."},400);
      const token=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
      const payload={application_id:applicationId,interviewer_id:interviewerId,scheduled_at:scheduledAt.toISOString(),duration_minutes:duration,timezone:"Asia/Karachi",room_name:`faculty-${crypto.randomUUID()}`,guest_token:token,status:"scheduled",interviewer_joined_at:null,applicant_joined_at:null,ended_at:null,reminder_24h_sent_at:null,reminder_1h_sent_at:null,created_by:user.id,updated_at:new Date().toISOString()};
      let interview;
      if(body.interview_id){const{data,error}=await svc.from("faculty_interviews").update(payload).eq("id",body.interview_id).select().single();if(error)return json({error:error.message},400);interview=data}
      else{const{data,error}=await svc.from("faculty_interviews").insert(payload).select().single();if(error)return json({error:error.message},400);interview=data}
      await svc.from("teacher_applications").update({status:"under_review",updated_at:new Date().toISOString()}).eq("id",applicationId);
      const when=new Intl.DateTimeFormat("en-PK",{dateStyle:"full",timeStyle:"short",timeZone:"Asia/Karachi"}).format(scheduledAt);
      const html=layout({preheader:`Your NIPS faculty interview is scheduled for ${when}.`,heading:"Faculty interview scheduled",body:`<tr><td style="padding:0 0 12px">Dear ${safe(app.full_name)},</td></tr><tr><td style="padding:0 0 12px">Your faculty interview with NIPS has been scheduled.</td></tr><tr><td style="padding:0 0 12px"><strong>Date and time:</strong> ${safe(when)} (Pakistan time)<br><strong>Duration:</strong> ${duration} minutes<br><strong>Interviewer:</strong> ${safe(interviewer.full_name)}</td></tr><tr><td style="padding:0 0 12px">Open the link a few minutes early. The secure Jitsi room will admit you after the interviewer joins. No portal account is required.</td></tr>`,cta:{label:"Join interview",url:publicLink(token)}});
      const sent=await sendEmail(Deno.env.get("RESEND_API_KEY")||"",Deno.env.get("NOTIFY_FROM")||"NIPS Portal <noreply@nips.com.pk>",app.email,"Faculty interview scheduled - NIPS",html,{replyTo:"info@nips.com.pk"});
      return json({ok:true,interview,email_sent:sent.ok});
    }

    const{data:interview}=await svc.from("faculty_interviews").select("*,teacher_applications(full_name,email)").eq("id",id).single();
    if(!interview)return json({error:"Interview not found"},404);
    if(action==="join"){
      if(!["scheduled","live"].includes(interview.status))return json({error:"This interview is not open."},409);
      await svc.from("faculty_interviews").update({status:"live",interviewer_joined_at:interview.interviewer_joined_at||new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id);
      return json(await signJaas(interview.room_name,user.id,admin.full_name||"NIPS interviewer",true));
    }
    if(action==="finish"){
      const status=["completed","no_show","cancelled"].includes(body.status)?body.status:"completed";
      const notes=String(body.interview_notes||"").trim().slice(0,5000)||null;
      const outcome=["advance","reschedule","approve","reject"].includes(body.outcome)?body.outcome:null;
      const{error}=await svc.from("faculty_interviews").update({status,interview_notes:notes,outcome,ended_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id);
      if(error)return json({error:error.message},400);
      return json({ok:true});
    }
    return json({error:"Invalid action"},400);
  }catch(e){return json({error:String(e instanceof Error?e.message:e)},500)}
});
