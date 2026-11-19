const C='notepad-v1';
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html','./media/hills.jpg']))));
self.addEventListener('fetch',e=>{if(e.request.method!='GET'||/\.mp4/.test(e.request.url))return;
 e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(C).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request)))});
