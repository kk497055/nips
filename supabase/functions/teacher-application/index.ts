import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { layout, sendEmail } from "../_shared/templates.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const clean=(v:unknown,max=200)=>String(v??"").trim().slice(0,max);
const safe=(v:unknown)=>clean(v,500).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const SUBJECTS=new Set(["physics","maths","chemistry","biology","computer","english","accounting","painting","calligraphy","sketching","other"]);

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const body=await req.json();
    const full_name=clean(body.full_name,160),email=clean(body.email,254).toLowerCase(),phone=clean(body.phone,50);
    const subjects=[...new Set((Array.isArray(body.subjects)?body.subjects:[]).map((x:unknown)=>clean(x,30).toLowerCase()).filter((x:string)=>SUBJECTS.has(x)))];
    if(!full_name||!email||!phone)return json({error:"Full name, email and phone are required."},400);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Enter a valid email address."},400);
    if(!subjects.length)return json({error:"Choose at least one teaching subject."},400);
    const svc=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const payload={full_name,email,phone,city:clean(body.city,100)||null,qualification:clean(body.qualification,200)||null,education_board:clean(body.education_board,160)||null,subjects,other_subject:clean(body.other_subject,160)||null,experience_years:Number.isFinite(Number(body.experience_years))?Math.max(0,Number(body.experience_years)):null,message:clean(body.message,1500)||null};
    const{data,error}=await svc.from("teacher_applications").insert(payload).select("id").single();
    if(error){
      if(error.code==="23505")return json({error:"An active faculty application already exists for this email. NIPS will contact you after review."},409);
      return json({error:error.message},400);
    }
    const html=layout({preheader:"NIPS has received your faculty application.",heading:"Faculty application received",body:`<tr><td style="padding:0 0 12px">Dear ${safe(full_name)},</td></tr><tr><td style="padding:0 0 12px">Thank you for your interest in teaching with <strong>NIPS Education Solutions SMC (Pvt) Ltd.</strong></td></tr><tr><td style="padding:0 0 12px">Your application has been received and is awaiting administrative review. This application does not yet provide teacher or portal access.</td></tr><tr><td style="padding:0 0 12px">We will email you whenever its status changes.</td></tr>`});
    const sent=await sendEmail(Deno.env.get("RESEND_API_KEY")||"",Deno.env.get("NOTIFY_FROM")||"NIPS Portal <noreply@nips.com.pk>",email,"Faculty application received — NIPS",html,{replyTo:"info@nips.com.pk"});
    return json({ok:true,application_id:data.id,email_sent:sent.ok});
  }catch(e){return json({error:String(e instanceof Error?e.message:e)},500)}
});

