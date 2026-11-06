import http from 'node:http';
import site from './dist/server/index.js';

const server=http.createServer(async (req,res)=>{
  const result=await site.fetch(new Request('http://127.0.0.1:4381'+req.url),process.env);
  res.writeHead(result.status,Object.fromEntries(result.headers));
  res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(4381,'127.0.0.1',()=>console.log('Local http://127.0.0.1:4381'));
