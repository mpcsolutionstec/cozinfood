import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
const demo=[{id:'k1',name:'Pizza Calabresa',quantity:1,destination_sector:'forno_pizza',status:'em_preparo',created_at:new Date(Date.now()-420000).toISOString(),notes:'Sem cebola',order_id:'PED-1042'},{id:'k2',name:'X-Burger da Casa',quantity:2,destination_sector:'cozinha',status:'pendente',created_at:new Date(Date.now()-180000).toISOString(),notes:'1 sem picles',order_id:'PED-1043'},{id:'k3',name:'Suco de laranja',quantity:2,destination_sector:'bar',status:'pendente',created_at:new Date(Date.now()-60000).toISOString(),notes:'',order_id:'PED-1043'}];
export function useKDSOrders(sector='all'){
 const [orders,setOrders]=useState(demo);
 useEffect(()=>{if(!supabase)return;let alive=true;const load=async()=>{let q=supabase.from('order_items').select('id,name,quantity,destination_sector,status,created_at,notes,order_id,orders(order_number)').in('status',['pendente','em_preparo','pronto']).order('created_at');if(sector!=='all')q=q.eq('destination_sector',sector);const {data}=await q;if(alive&&data)setOrders(data.map(x=>({...x,order_id:x.orders?.order_number??x.order_id})))};load();const ch=supabase.channel(`kds-${sector}`).on('postgres_changes',{event:'*',schema:'public',table:'order_items'},load).subscribe();return()=>{alive=false;supabase.removeChannel(ch)}},[sector]);
 const changeStatus=async(id,status)=>{if(!supabase)return setOrders(p=>p.map(x=>x.id===id?{...x,status}:x));const {error}=await supabase.from('order_items').update({status}).eq('id',id);if(error)throw error};
 return {orders,changeStatus,live:Boolean(supabase)};
}
