// Read-only administrative diagnosis for per-Fanpage Reels queues.
// Never return stored OAuth tokens, secrets or raw DB credentials.
export function pageQueueDiagnostics(pages,campaigns,jobs,{now=Date.now(),partial=false}={}){
  if(!Array.isArray(pages)||!Array.isArray(campaigns)||!Array.isArray(jobs))throw Error("Invalid diagnostics data");
  const campaignsById=new Map(campaigns.map(x=>[x.id,x]));
  return pages.map(page=>{
    const pageId=String(page.page_id);
    const active=page.active===true;
    const pageCampaigns=campaigns.filter(x=>String(x.page_id)===pageId);
    const pageJobs=jobs.filter(x=>String(x.page_id)===pageId);
    const totals={queued:0,uploading:0,processing:0,published:0,failed:0,cancelled:0};
    let due=0,blocked=0,staleUploading=0,unknownPublishing=0;
    let nextAt=null,oldestDue=null,lastError=null;
    let recentErrorTime=-Infinity;
    for(const job of pageJobs){
      const status=String(job.status||"");
      if(Object.hasOwn(totals,status))totals[status]++;
      const timestamp=Date.parse(job.scheduled_at);
      const isDue=Number.isFinite(timestamp)&&timestamp<=now;
      const campaign=campaignsById.get(job.campaign_id);
      const eligible=active&&campaign?.status==="active";
      if(status==="queued"){
        if(isDue){
          if(eligible){due++;if(!oldestDue||timestamp<Date.parse(oldestDue))oldestDue=job.scheduled_at;}
          else blocked++;
        }else if(Number.isFinite(timestamp)&&(!nextAt||timestamp<Date.parse(nextAt)))nextAt=job.scheduled_at;
      }
      if(status==="uploading"&&Date.parse(job.updated_at)<now-35*60000)staleUploading++;
      if(status==="processing"&&Date.parse(job.updated_at)<now-60*60000)unknownPublishing++;
      const updated=Date.parse(job.updated_at);
      if(status==="failed"&&job.error&&Number.isFinite(updated)&&updated>recentErrorTime){
        recentErrorTime=updated;lastError=String(job.error).slice(0,240);
      }
    }
    let reason;
    if(!pageCampaigns.length)reason="Chưa có chiến dịch được lưu cho Page này";
    else if(!active)reason="Fanpage đang tắt; worker sẽ không nhận bài";
    else if(!pageCampaigns.some(x=>x.status==="active"))reason="Không có chiến dịch đang hoạt động";
    else if(blocked)reason="Có bài đến hạn nhưng chiến dịch đã tạm dừng";
    else if(staleUploading)reason="Có bài đang upload quá lâu, cần kiểm tra trước khi thử lại";
    else if(due)reason=due+" bài đã đến hạn đang chờ worker";
    else if(totals.failed)reason=totals.failed+" bài đăng lỗi, mở Chi tiết để xem nguyên nhân";
    else if(totals.processing)reason="Meta đang xử lý video, chưa xác nhận đã đăng";
    else if(totals.queued)reason="Chưa đến giờ của các bài còn trong hàng đợi";
    else reason="Không có bài chờ đăng";
    return {
      pageId,name:String(page.name||pageId),active,
      campaigns:pageCampaigns.length,activeCampaigns:pageCampaigns.filter(x=>x.status==="active").length,
      jobs:pageJobs.length,totals,due,blocked,staleUploading,unknownPublishing,
      oldestDue,nextAt,lastError,reason,partial
    };
  });
}
