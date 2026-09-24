import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { layout, sendEmail } from "../_shared/templates.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const safe=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  try{
    const svc=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const token=(req.headers.get("Authorization")||"").replace("Bearer ","");
    const{data:{user}}=await svc.auth.getUser(token);
    if(!user)return json({error:"Invalid session"},401);
    const{data:admin}=await svc.from("profiles").select("role,is_active").eq("id",user.id).single();
    if(admin?.role!=="admin"||admin?.is_active===false)return json({error:"Forbidden"},403);
    const body=await req.json(),applicationId=String(body.application_id||""),status=String(body.status||"");
    if(!["under_review","approved","rejected"].includes(status))return json({error:"Invalid status"},400);
    const{data:app,error:readError}=await svc.from("teacher_applications").select("*").eq("id",applicationId).single();
    if(readError||!app)return json({error:"Application not found"},404);
    if(app.status==="approved")return json({error:"This application is already approved."},409);
    let teacherId:string|null=app.teacher_id||null,actionLink="https://nips.com.pk/portal/login.html";
    if(status==="approved"){
      let existing:any=null;
      for(let page=1;page<=10&&!existing;page++){
        const{data,error}=await svc.auth.admin.listUsers({page,perPage:200});
        if(error)return json({error:error.message},500);
        existing=data.users.find(u=>u.email?.toLowerCase()===app.email.toLowerCase());
        if(data.users.length<200)break;
      }
      if(existing){
        const{data:profile}=await svc.from("profiles").select("role").eq("id",existing.id).maybeSingle();
        if(profile?.role==="student")return json({error:"This email already belongs to a student account. Review it manually before changing roles."},409);
        teacherId=existing.id;
      }else{
        const password=crypto.randomUUID()+"Aa1!";
        const{data:created,error}=await svc.auth.admin.createUser({email:app.email,password,email_confirm:true,user_metadata:{full_name:app.full_name}});
        if(error)return json({error:error.message},400);
        teacherId=created.user.id;
      }
      await svc.from("profiles").update({full_name:app.full_name,role:"teacher",is_active:true}).eq("id",teacherId);
      const{error:profileError}=await svc.from("teacher_profiles").upsert({teacher_id:teacherId,contact_email:app.email,phone:app.phone,city:app.city,qualification:app.qualification,education_board:app.education_board,subjects:app.subjects,other_subject:app.other_subject,experience_years:app.experience_years,updated_at:new Date().toISOString()});
      if(profileError)return json({error:profileError.message},500);
      const{data:link,error:linkError}=await svc.auth.admin.generateLink({type:"recovery",email:app.email,options:{redirectTo:"https://nips.com.pk/portal/reset-password.html"}});
      if(!linkError&&link?.properties?.action_link)actionLink=link.properties.action_link;
    }
    const now=new Date().toISOString();
    const{error:updateError}=await svc.from("teacher_applications").update({status,admin_note:String(body.admin_note||"").trim().slice(0,1000)||null,teacher_id:teacherId,reviewed_at:now,reviewed_by:user.id,updated_at:now}).eq("id",applicationId);
    if(updateError)return json({error:updateError.message},500);
    const copy=status==="approved"?{subject:"Faculty application approved — NIPS",heading:"Welcome to the NIPS faculty",body:`Your faculty application has been approved. Use the button below to set your password and access the teacher portal.`,cta:{label:"Set password and access portal",url:actionLink}}:status==="under_review"?{subject:"Faculty application under review — NIPS",heading:"Your application is under review",body:"The NIPS team is reviewing your faculty application. We will email you after a decision is made."}:{subject:"Faculty application update — NIPS",heading:"Faculty application update",body:`Thank you for your interest in NIPS. We are unable to approve your faculty application at this time.${body.admin_note?`<br><br>${safe(String(body.admin_note).slice(0,1000))}`:""}`};
    const html=layout({preheader:copy.subject,heading:copy.heading,body:`<tr><td style="padding:0 0 12px">Dear ${safe(app.full_name)},</td></tr><tr><td style="padding:0 0 12px">${copy.body}</td></tr>`,cta:copy.cta});
    const sent=await sendEmail(Deno.env.get("RESEND_API_KEY")||"",Deno.env.get("NOTIFY_FROM")||"NIPS Portal <noreply@nips.com.pk>",app.email,copy.subject,html,{replyTo:"info@nips.com.pk"});
    return json({ok:true,status,teacher_id:teacherId,email_sent:sent.ok});
  }catch(e){return json({error:String(e instanceof Error?e.message:e)},500)}
});
