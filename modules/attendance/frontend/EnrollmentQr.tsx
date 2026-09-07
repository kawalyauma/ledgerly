type Matrix=boolean[][];

function gfMultiply(x:number,y:number){
  let z=0;
  while(y){
    if(y&1)z^=x;
    y>>>=1;
    x<<=1;
    if(x&0x100)x^=0x11d;
  }
  return z;
}

function rsGenerator(degree:number){
  let generator=[1],root=1;
  for(let i=0;i<degree;i++){
    const next=new Array(generator.length+1).fill(0);
    for(let j=0;j<generator.length;j++){
      next[j]^=generator[j];
      next[j+1]^=gfMultiply(generator[j],root);
    }
    generator=next;
    root=gfMultiply(root,2);
  }
  return generator;
}

function rsRemainder(data:number[],degree:number){
  const generator=rsGenerator(degree),remainder=new Array(degree).fill(0);
  for(const byte of data){
    const factor=byte^remainder[0];
    remainder.shift();
    remainder.push(0);
    for(let i=0;i<degree;i++)remainder[i]^=gfMultiply(generator[i+1],factor);
  }
  return remainder;
}

function appendBits(target:number[],value:number,count:number){
  for(let i=count-1;i>=0;i--)target.push((value>>>i)&1);
}

function codewords(value:string){
  const bytes=Array.from(new TextEncoder().encode(value));
  if(bytes.length>78)throw new Error("Enrollment QR payload is too long");
  const bits:number[]=[];
  appendBits(bits,0b0100,4);
  appendBits(bits,bytes.length,8);
  for(const byte of bytes)appendBits(bits,byte,8);
  const capacity=80*8;
  for(let i=0;i<Math.min(4,capacity-bits.length);i++)bits.push(0);
  while(bits.length%8)bits.push(0);
  const data:number[]=[];
  for(let i=0;i<bits.length;i+=8){let byte=0;for(let j=0;j<8;j++)byte=(byte<<1)|bits[i+j];data.push(byte)}
  for(let pad=0;data.length<80;pad++)data.push(pad%2===0?0xec:0x11);
  return [...data,...rsRemainder(data,20)];
}

function formatBits(){
  const data=0b01000,generator=0x537;
  let remainder=data<<10;
  const degree=(n:number)=>31-Math.clz32(n);
  while(degree(remainder)>=10)remainder^=generator<<(degree(remainder)-10);
  return ((data<<10)|remainder)^0x5412;
}

function makeMatrix(value:string):Matrix{
  const size=33,matrix:Matrix=Array.from({length:size},()=>Array(size).fill(false)),reserved:Matrix=Array.from({length:size},()=>Array(size).fill(false));
  const set=(x:number,y:number,dark:boolean,reserve=true)=>{if(x>=0&&x<size&&y>=0&&y<size){matrix[y][x]=dark;if(reserve)reserved[y][x]=true}};
  const finder=(x:number,y:number)=>{for(let dy=-1;dy<=7;dy++)for(let dx=-1;dx<=7;dx++){const inside=dx>=0&&dx<=6&&dy>=0&&dy<=6,dark=inside&&(dx===0||dx===6||dy===0||dy===6||(dx>=2&&dx<=4&&dy>=2&&dy<=4));set(x+dx,y+dy,dark)}};
  finder(0,0);finder(size-7,0);finder(0,size-7);
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(26+dx,26+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  for(let i=8;i<size-8;i++){
    if(!reserved[6][i])set(i,6,i%2===0);
    if(!reserved[i][6])set(6,i,i%2===0);
  }
  const format=formatBits();
  for(let i=0;i<15;i++){
    const bit=((format>>>i)&1)!==0;
    if(i<6)set(8,i,bit);else if(i<8)set(8,i+1,bit);else set(8,size-15+i,bit);
    if(i<8)set(size-i-1,8,bit);else if(i<9)set(15-i,8,bit);else set(14-i,8,bit);
  }
  set(8,size-8,true);
  const dataBits:number[]=[];
  for(const byte of codewords(value))appendBits(dataBits,byte,8);
  let index=0,row=size-1,direction=-1;
  for(let column=size-1;column>0;column-=2){
    if(column===6)column--;
    while(true){
      for(let offset=0;offset<2;offset++){
        const x=column-offset;
        if(!reserved[row][x]){
          const bit=index<dataBits.length?dataBits[index]:0;
          index++;
          set(x,row,Boolean(bit)^((row+x)%2===0),false);
        }
      }
      row+=direction;
      if(row<0||row>=size){row-=direction;direction=-direction;break}
    }
  }
  return matrix;
}

export function EnrollmentQr({value,size=260}:{value:string;size?:number}){
  const matrix=makeMatrix(value),quiet=4,view=matrix.length+quiet*2;
  let path="";
  for(let y=0;y<matrix.length;y++)for(let x=0;x<matrix.length;x++)if(matrix[y][x])path+=`M${x+quiet} ${y+quiet}h1v1h-1z`;
  return <svg role="img" aria-label="Kiosk enrollment QR code" width={size} height={size} viewBox={`0 0 ${view} ${view}`} shapeRendering="crispEdges"><rect width={view} height={view} fill="white"/><path d={path} fill="#071b13"/></svg>;
}
