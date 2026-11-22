const escMap = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escape = s => s.replace(/[&<>"']/g, c => escMap[c]);
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const dateLong = d => `${Number(d.slice(8))} ${months[Number(d.slice(5,7))-1]} ${d.slice(0,4)}`;
function slug(s) {
  if (/[^\x00-\x7f]/.test(s)) s = s.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '', gap = false;
  for (const c of s) {
    let v = c >= 'A' && c <= 'Z' ? c.toLowerCase() : ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) ? c : '';
    if (!v) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    out += v; gap = false;
  }
  return out.slice(0,64).replace(/-+$/, '') || 'untitled';
}
function unique(s, used) { let v=s, i=2; while (used.has(v)) v=`${s}-${i++}`; used.add(v); return v; }
const fmLine = /^([a-z_]+):(?: (.*))?$/, datePattern = /^(\d{4})-(\d{2})-(\d{2})$/, namePattern = /^[a-z0-9-]+$/, slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const keys = new Set(['title','summary','date','tags','draft','layout','slug']);
function front(text) {
  if (text !== '---' && !text.startsWith('---\n')) return {error:'no front matter'};
  let pos=4, close=-1, end=0;
  while (pos <= text.length) { end=text.indexOf('\n',pos); if(end<0) end=text.length; if(text.slice(pos,end)==='---') {close=pos;break;} if(end===text.length) break; pos=end+1; }
  if(close<0) return {error:'the front matter is not closed'};
  const data={}; pos=4; let lineNo=2;
  while(pos<close) {
    let e=text.indexOf('\n',pos); if(e<0)e=text.length;
    const line=text.slice(pos,e); pos=e+1;
    if (/^[ \t]*$/.test(line) || line.startsWith('#')) {lineNo++;continue;}
    const m=fmLine.exec(line); if(!m)return {error:`line ${lineNo} is not "key: value"`};
    const key=m[1], raw=(m[2]??'').replace(/[ \t]+$/,''); lineNo++;
    if(!keys.has(key))return {error:`unknown key "${key}"`};
    if(Object.hasOwn(data,key))return {error:`key "${key}" is given twice`};
    if(!raw)return {error:`key "${key}" has no value`};
    let val=raw, error;
    if(key==='title'||key==='summary') {
      if(raw.startsWith('"')) {
        if(raw.length<2||!raw.endsWith('"')) error='a quoted string is not closed';
        else { val=''; for(let i=1;i<raw.length-1;i++) { const c=raw[i]; if(c==='\\') { const n=raw[++i]; if((n!=='"'&&n!=='\\')||i===raw.length-1){error='a quoted string holds an escape other than \\" or \\\\';break;} val+=n; } else if(c==='"'){error='a quoted string holds a stray quote';break;} else val+=c; } }
      } else if(raw.startsWith('[')) error='a bare string opens on [';
      if(error) return {error:`key "${key}": ${error}`};
    } else if(key==='date') {
      const m=datePattern.exec(raw), y=m?+m[1]:0, mo=m?+m[2]:0, d=m?+m[3]:0;
      const days=mo===2?((y%4===0&&y%100!==0)||y%400===0?29:28):([4,6,9,11].includes(mo)?30:31);
      if(!m||y<1970||y>2099||mo<1||mo>12||d<1||d>days)return {error:'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)'};
    } else if(key==='tags') {
      if(!raw.startsWith('[')||!raw.endsWith(']'))return {error:'key "tags": not a list [a, b]'};
      const inner=raw.slice(1,-1); val=inner.trim()===''?[]:inner.split(',').map(x=>x.trim());
      if(val.some(x=>!x||/["\[\]]/.test(x)))return {error:'key "tags": an empty tag, or one holding " [ or ]'};
    } else if(key==='draft') { if(raw!=='true'&&raw!=='false')return {error:'key "draft": true or false'}; val=raw==='true'; }
    else if(key==='layout'&&!namePattern.test(raw))return {error:'key "layout": not a template name'};
    else if(key==='slug'&&(!slugPattern.test(raw)||raw.length>64))return {error:'key "slug": not a slug'};
    data[key]=val;
  }
  if(!Object.hasOwn(data,'title'))return {error:'no title'};
  return {data,body:end===text.length?'':text.slice(end+1)};
}
const pathPattern=/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const forPattern=/^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/, ifPattern=/^if (not )?(\S+)$/, includePattern=/^include "([a-z0-9-]+)"$/;
function parseTemplate(name,src) {
  const fail=reason=>{throw new Error(`template "${name}": ${reason}`)};
  const path=s=>{if(!pathPattern.test(s))fail(`${JSON.stringify(s)} is not a path`);return s.split('.')};
  const tokens=[]; let text='',i=0;
  while(i<src.length) {
    const open=src.indexOf('{',i);
    if(open<0||open===src.length-1){text+=src.slice(i);break;}
    const next=src[open+1]; if(next!=='{'&&next!=='%'){text+=src.slice(i,open+1);i=open+1;continue;}
    text+=src.slice(i,open);
    if(next==='{') {
      const raw=src[open+2]==='{', close=src.indexOf(raw?'}}}':'}}',open+(raw?3:2));
      if(close<0)fail(`a ${raw?'{{{':'{{'} is not closed`);
      if(text)tokens.push({kind:'text',text}); text=''; tokens.push({kind:raw?'raw':'var',path:path(src.slice(open+(raw?3:2),close).trim())});i=close+(raw?3:2);
    } else {
      const close=src.indexOf('%}',open+2);if(close<0)fail('a {% is not closed');
      const end=close+2,start=src.lastIndexOf('\n',open-1)+1,nl=src.indexOf('\n',end),lineEnd=nl<0?src.length:nl;
      const standalone=/^[ \t]*$/.test(src.slice(start,open))&&/^[ \t]*$/.test(src.slice(end,lineEnd));
      if(standalone)text=text.slice(0,text.length-(open-start));
      if(text)tokens.push({kind:'text',text});text='';tokens.push({kind:'tag',tag:src.slice(open+2,close).trim()});i=standalone?(nl<0?src.length:nl+1):end;
    }
  }
  if(text)tokens.push({kind:'text',text});
  const root={kind:'root',body:[]},stack=[root];let body=root.body;
  for(const t of tokens) {
    if(t.kind!=='tag'){body.push(t);continue;}
    const tag=t.tag,top=stack[stack.length-1];let m;
    if((m=forPattern.exec(tag))) {const n={kind:'for',name:m[1],path:path(m[2]),body:[]};body.push(n);stack.push(n);body=n.body;}
    else if((m=ifPattern.exec(tag))) {const n={kind:'if',not:m[1]!==undefined,path:path(m[2]),then:[],else:null};body.push(n);stack.push(n);body=n.then;}
    else if(tag==='else'){if(top.kind!=='if'||top.else!==null)fail('an else outside an if');top.else=[];body=top.else;}
    else if(tag==='endfor'||tag==='endif') {if(top.kind!==(tag==='endfor'?'for':'if'))fail(`an ${tag} with no open ${tag.slice(3)}`);stack.pop();const p=stack[stack.length-1];body=p.kind==='root'||p.kind==='for'?p.body:p.else??p.then;}
    else if((m=includePattern.exec(tag)))body.push({kind:'include',name:m[1]});
    else fail(`{% ${tag} %} is not a tag`);
  }
  if(stack.length>1)fail(`a ${stack[stack.length-1].kind} is not closed`);
  return root.body;
}
function lookup(scope,path) {
  while(scope&&!Object.hasOwn(scope.vars,path[0]))scope=scope.parent;
  if(!scope)return undefined;let v=scope.vars[path[0]];
  for(let i=1;i<path.length;i++){if(v===null||typeof v!=='object'||!Object.hasOwn(v,path[i]))return undefined;v=v[path[i]];}
  return v;
}
function textValue(v) {if(typeof v==='string')return v;if(typeof v==='number'||typeof v==='boolean')return String(v);if(Array.isArray(v))return v.map(textValue).join(', ');return '';}
function render(nodes,scope,templates,depth,out) {
  for(let i=0;i<nodes.length;i++) {const n=nodes[i];
    if(n.kind==='text')out.push(n.text);
    else if(n.kind==='var'||n.kind==='raw'){const v=textValue(lookup(scope,n.path));out.push(n.kind==='var'?escape(v):v);}
    else if(n.kind==='if'){const v=lookup(scope,n.path),yes=Array.isArray(v)?v.length>0:v!==undefined&&v!==null&&v!==false&&v!==''&&v!==0;const branch=yes!==n.not?n.then:n.else;if(branch)render(branch,scope,templates,depth,out);}
    else if(n.kind==='for'){const xs=lookup(scope,n.path);if(Array.isArray(xs))for(let k=0;k<xs.length;k++){const vars={[n.name]:xs[k],loop:{index:k+1,first:k===0,last:k===xs.length-1,length:xs.length}};render(n.body,{vars,parent:scope},templates,depth,out);}}
    else {const t=templates.get(n.name);if(t!==undefined&&depth<8)render(t,scope,templates,depth+1,out);}
  }
}
const escapable=new Set(['\\','`','*','_','[',']','(',')','#','+','-','.','!','>']);
function findUnescaped(s,what,from) {for(let j=from;j<=s.length-what.length;j++){if(s[j]==='\\'&&j+1<s.length&&escapable.has(s[j+1])){j++;continue;}if(s.startsWith(what,j))return j;}return -1;}
function singleStar(s,from) {for(let j=from;j<s.length;j++){if(s[j]==='\\'&&j+1<s.length&&escapable.has(s[j+1])){j++;continue;}if(s[j]==='*'){if(s[j+1]==='*'){j++;continue;}return j;}}return -1;}
function inline(s,link) {
  const out=[];let i=0,start=0;
  while(i<s.length) {const c=s[i];
    if(c!=='\\'&&c!=='`'&&c!=='*'&&c!=='['){i++;continue;}
    if(i>start)out.push(escape(s.slice(start,i)));
    if(c==='\\'&&i+1<s.length&&escapable.has(s[i+1])){out.push(escape(s[i+1]));i+=2;}
    else if(c==='`'){const j=s.indexOf('`',i+1);if(j>i+1){out.push('<code>',escape(s.slice(i+1,j)),'</code>');i=j+1;}else{out.push('`');i++;}}
    else if(c==='*') {const strong=s[i+1]==='*',step=strong?2:1,j=strong?findUnescaped(s,'**',i+2):singleStar(s,i+1);if(j>i+step){out.push(strong?'<strong>':'<em>',inline(s.slice(i+step,j),link),strong?'</strong>':'</em>');i=j+step;}else{out.push(strong?'**':'*');i+=step;}}
    else if(c==='['){const k=findUnescaped(s,']',i+1),m=k!==-1&&s[k+1]==='('?s.indexOf(')',k+2):-1,target=m<0?'':s.slice(k+2,m);if(target&&!/\s/.test(target)){out.push('<a href="',escape(link(target)),'">',inline(s.slice(i+1,k),link),'</a>');i=m+1;}else{out.push('[');i++;}}
    else {out.push('\\');i++;} start=i;
  }
  if(start<s.length)out.push(escape(s.slice(start)));
  return out.join('');
}
const blank=/^[ \t]*$/, fence=/^```([A-Za-z0-9_+-]*)[ \t]*$/, fenceEnd=/^```[ \t]*$/, heading=/^(#{1,6})[ \t]+(.*?)[ \t]*$/, hr=/^(?:---|\*\*\*)[ \t]*$/, bullet=/^[-*] (.*)$/, ordered=/^(\d{1,9})\. (.*)$/, continued=/^ {2,}\S/;
const trimLine=s=>s.replace(/^[ \t]+|[ \t]+$/g,'');
function headingOf(s){const m=heading.exec(s);return m&&m[2]!==''?m:null;}
function markdown(src,link) {
  const lines=src.split('\n'),blocks=[],toc=[],ids=new Set();let i=0,excerpt=null;
  while(i<lines.length){const line=lines[i];if(blank.test(line)){i++;continue;}let m;
    if((m=fence.exec(line))){const lang=m[1],body=[];i++;while(i<lines.length&&!fenceEnd.test(lines[i]))body.push(escape(lines[i++]),'\n');i++;blocks.push(`<pre><code${lang?' class="language-'+escape(lang)+'"':''}>`,body.join(''),'</code></pre>\n');continue;}
    if((m=headingOf(line))){const level=m[1].length,id=unique(slug(m[2]),ids),html=inline(m[2],link);blocks.push(`<h${level} id="${id}">${html}</h${level}>\n`);if(level===2||level===3)toc.push({level,id,html});i++;continue;}
    if(hr.test(line)){blocks.push('<hr>\n');i++;continue;}
    if(line.startsWith('>')){const body=[];while(i<lines.length&&lines[i].startsWith('>')){const v=trimLine(lines[i++].replace(/^> ?/,''));if(v)body.push(v);}blocks.push(body.length?`<blockquote>\n<p>${inline(body.join('\n'),link)}</p>\n</blockquote>\n`:'<blockquote>\n</blockquote>\n');continue;}
    const b=bullet.exec(line),o=b?null:ordered.exec(line);
    if(b||o){const marker=o?ordered:bullet,items=[];while(i<lines.length){const z=marker.exec(lines[i]);if(z){items.push([trimLine(o?z[2]:z[1])]);i++;}else if(continued.test(lines[i]))items[items.length-1].push(trimLine(lines[i++]));else break;}
      const tag=o?'ol':'ul',start=o?Number(o[1]):1;blocks.push(o&&start!==1?`<ol start="${start}">\n`:`<${tag}>\n`);for(const item of items)blocks.push('<li>',inline(item.join('\n'),link),'</li>\n');blocks.push(`</${tag}>\n`);continue;}
    const body=[trimLine(line)];i++;while(i<lines.length&&!blank.test(lines[i])&&!fence.test(lines[i])&&!headingOf(lines[i])&&!hr.test(lines[i]))body.push(trimLine(lines[i++]));const html=inline(body.join('\n'),link);if(excerpt===null)excerpt=html;blocks.push('<p>',html,'</p>\n');
  }
  return {html:blocks.join(''),toc,excerpt:excerpt??''};
}
const dirOf=p=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';
function resolve(dir,rel){const parts=dir?dir.split('/'):[];for(const s of rel.split('/')){if(!s||s==='.')continue;if(s==='..'){if(!parts.length)return null;parts.pop();}else parts.push(s);}return parts.join('/');}
const scheme=/^[A-Za-z][A-Za-z0-9+.-]*:/;
export function run(input) {
  const base=input.site.base_url.replace(/\/+$/,''), templates=new Map(), report=[], broken=new Set(), sources=[],statics=[],bySource=new Map(),output={};
  for(const name of Object.keys(input.templates).sort(cmp)){try{templates.set(name,parseTemplate(name,input.templates[name]));}catch(e){report.push(e.message);}}
  const files=[...input.files].sort((a,b)=>cmp(a.path,b.path));
  for(const f of files){if(!f.path.endsWith('.md')){statics.push(f);continue;}const fm=front(f.content.replace(/\r\n?/g,'\n'));if(fm.error){report.push(`refused ${f.path}: ${fm.error}`);continue;}
    const post=f.path.startsWith('posts/'),own=f.path.startsWith('tags/')?'tags':f.path.startsWith('page/')?'page':null;
    if(own){report.push(`refused ${f.path}: ${own}/ is the generator's own`);continue;}
    if(post&&!Object.hasOwn(fm.data,'date')){report.push(`refused ${f.path}: a post needs a date`);continue;}
    const layout=fm.data.layout??(post?'post':'page');if(!templates.has(layout)){report.push(`refused ${f.path}: layout "${layout}" is no template that parses`);continue;}
    if(fm.data.draft===true){report.push(`draft ${f.path}`);continue;}sources.push({path:f.path,data:fm.data,body:fm.body,post,layout});
  }
  const taken=new Map();for(const s of sources){const dir=s.post?'posts':dirOf(s.path);if(!taken.has(dir))taken.set(dir,new Set(dir===''?['posts','tags','page']:[]));s.slug=unique(s.data.slug??slug(s.data.title),taken.get(dir));s.outDir=dir?`${dir}/${s.slug}`:s.slug;s.url=`${base}/${s.outDir}/`;bySource.set(s.path,s);}
  const staticPaths=new Set(statics.map(f=>f.path));
  for(const s of sources){const dir=dirOf(s.path);const link=target=>{if(scheme.test(target)||target.startsWith('/')||target.startsWith('#'))return target;const h=target.indexOf('#'),rel=h<0?target:target.slice(0,h),frag=h<0?'':target.slice(h),p=rel?resolve(dir,rel):null;if(p!==null&&bySource.has(p))return bySource.get(p).url+frag;if(p!==null&&staticPaths.has(p))return `${base}/${p}${frag}`;broken.add(`broken-link ${s.path} -> ${target}`);return target;};Object.assign(s,markdown(s.body,link));}
  const posts=sources.filter(s=>s.post).sort((a,b)=>cmp(b.data.date,a.data.date)||cmp(a.slug,b.slug));
  for(let i=0;i<posts.length;i++){posts[i].newer=i?posts[i-1]:null;posts[i].older=i+1<posts.length?posts[i+1]:null;}
  const tagMap=new Map();
  function ownTags(s){const seen=new Set(),out=[];for(const name of s.data.tags??[]){const id=slug(name);if(!seen.has(id)){seen.add(id);out.push([name,id]);}}return out;}
  for(const p of posts){p.tagRefs=[];for(const [name,id] of ownTags(p)){if(!tagMap.has(id))tagMap.set(id,{name,slug:id,url:`${base}/tags/${id}/`,posts:[]});const t=tagMap.get(id);t.posts.push(p);p.tagRefs.push(t);}}
  for(const s of sources)if(!s.post)s.tagRefs=ownTags(s).map(([name,id])=>tagMap.get(id)??{name,slug:id,url:'',posts:[]});
  const tags=[...tagMap.values()].sort((a,b)=>b.posts.length-a.posts.length||cmp(a.slug,b.slug));
  const card=s=>({title:s.data.title,url:s.url,date:s.data.date??'',date_long:s.data.date===undefined?'':dateLong(s.data.date),summary:s.data.summary??'',excerpt:s.excerpt,reading_minutes:Math.max(1,Math.ceil((s.body.match(/\S+/g)?.length??0)/200)),tags:s.tagRefs.map(t=>({name:t.name,slug:t.slug,url:t.url}))});
  const linkOf=s=>s?{title:s.data.title,url:s.url,date:s.data.date??'',date_long:s.data.date===undefined?'':dateLong(s.data.date)}:null;
  const cards=new Map(posts.map(p=>[p,card(p)])),site={title:input.site.title,base_url:base},allTags=tags.map(t=>({name:t.name,slug:t.slug,url:t.url,count:t.posts.length})),recent=posts.slice(0,input.site.recent).map(p=>cards.get(p));
  const renderPage=(name,vars)=>{const nodes=templates.get(name);if(nodes===undefined)return null;const out=[];render(nodes,{vars:{site,tags:allTags,recent,...vars},parent:null},templates,0,out);return out.join('');};
  for(const s of sources){const page={...(s.post?cards.get(s):card(s)),slug:s.slug,content:s.html,toc:s.toc.map(h=>({level:h.level,id:h.id,html:h.html})),newer:linkOf(s.newer??null),older:linkOf(s.older??null),is_post:s.post};output[`${s.outDir}/index.html`]=renderPage(s.layout,{page});}
  const per=input.site.per_page,pages=Math.max(1,Math.ceil(posts.length/per)),indexUrl=k=>k===1?`${base}/`:`${base}/page/${k}/`;
  for(let k=1;k<=pages;k++){const html=renderPage('index',{posts:posts.slice((k-1)*per,k*per).map(p=>cards.get(p)),pager:{number:k,total:pages,url:indexUrl(k),newer_url:k===1?'':indexUrl(k-1),older_url:k===pages?'':indexUrl(k+1)}});if(html!==null)output[k===1?'index.html':`page/${k}/index.html`]=html;}
  for(const t of tags){const tag={name:t.name,slug:t.slug,url:t.url,count:t.posts.length,posts:t.posts.map(p=>cards.get(p))},html=renderPage('tag',{tag});if(html!==null)output[`tags/${t.slug}/index.html`]=html;}
  const tagsHtml=renderPage('tags',{});if(tagsHtml!==null)output['tags/index.html']=tagsHtml;
  for(const f of statics){if(Object.hasOwn(output,f.path))report.push(`shadowed ${f.path}: a built page has its path`);else output[f.path]=f.content;}
  const lines=[...report,...broken].sort(cmp);lines.push(`built ${sources.length-posts.length} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);output['build-report.txt']=lines.join('\n')+'\n';return output;
}
