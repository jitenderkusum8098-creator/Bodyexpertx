/* BodyExpertX shared quantity cart — keep booking/payment rules in each page unchanged. */
(function(){
  "use strict";
  if(!Array.isArray(cart)) return;
  var courseMode=!!document.getElementById("studentForm");
  var originalRender=window.renderCart;
  function safe(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]})}
  function moneyText(value){
    try{
      if(courseMode && typeof rupees==="function") return rupees(value);
      if(typeof money==="function") return money(value);
    }catch(e){}
    return "₹"+Math.round(Number(value)||0).toLocaleString("en-IN");
  }
  function subtotal(){return cart.reduce(function(sum,item){return sum+(Number(item.price)||0)*(Number(item.quantity)||1)},0)}
  window.totalPrice=function(){return subtotal()};
  window.bexAddCartItem=function(item){
    if(!item || typeof item!=="object") return;
    var id=String(item.id||"");
    var match=cart.find(function(existing){
      if(id && existing.id) return String(existing.id)===id;
      return String(existing.name||"")===String(item.name||"") &&
        Number(existing.duration||0)===Number(item.duration||0) &&
        String(existing.type||"")===String(item.type||"") &&
        String(existing.category||"")===String(item.category||"") &&
        Number(existing.price||0)===Number(item.price||0);
    });
    if(match){match.quantity=(Number(match.quantity)||1)+1;}
    else{item.quantity=1;cart.push(item);}
    if(typeof window.renderCart==="function") window.renderCart();
  };
  window.bexChangeCartQuantity=function(index,delta){
    var item=cart[index]; if(!item) return;
    var qty=Number(item.quantity)||1;
    if(delta<0 && qty<=1){
      if(typeof window.removeItem==="function") window.removeItem(index);
      else if(typeof window.removeCourse==="function") window.removeCourse(index);
      else{cart.splice(index,1);window.renderCart();}
      return;
    }
    item.quantity=Math.max(1,qty+(Number(delta)||0));
    if(typeof window.renderCart==="function") window.renderCart();
  };
  function renderRows(){
    var box=document.getElementById("cartItems");
    if(!box) return;
    if(!cart.length) return;
    box.classList.remove("cart-empty");
    box.innerHTML=cart.map(function(item,index){
      var qty=Math.max(1,Number(item.quantity)||1);
      var price=Number(item.price)||0;
      var name=safe(item.name||item.title||"Selected service");
      var detail=courseMode?safe(item.detail||""):(Number(item.duration)>0?Number(item.duration)+" min session":"");
      return '<article class="bex-universal-cart-row">'+
        '<div class="bex-universal-cart-info"><strong>'+name+'</strong>'+
        (detail?'<small>'+detail+'</small>':'')+
        '<small>'+moneyText(price)+' each</small></div>'+
        '<div class="bex-universal-cart-bottom"><strong class="bex-universal-line-total">'+moneyText(price*qty)+'</strong>'+
        '<div class="bex-universal-qty" role="group" aria-label="Change quantity for '+name+'">'+
        '<button type="button" aria-label="Decrease quantity" onclick="bexChangeCartQuantity('+index+',-1)">−</button>'+
        '<span aria-live="polite">'+qty+'</span>'+
        '<button type="button" aria-label="Increase quantity" onclick="bexChangeCartQuantity('+index+',1)">+</button>'+
        '</div></div></article>';
    }).join("");
    var sum=subtotal();
    var subtotalEl=document.getElementById("subtotal");
    if(subtotalEl) subtotalEl.textContent=moneyText(sum);
    var discountEl=document.getElementById("discount");
    if(discountEl && typeof discountPrice==="function") discountEl.textContent=moneyText(discountPrice());
    var totalEl=document.getElementById("total");
    if(totalEl){
      var total=typeof finalPrice==="function"?finalPrice():sum;
      totalEl.textContent=moneyText(total);
    }
  }
  window.renderCart=function(){
    if(typeof originalRender==="function") originalRender.apply(this,arguments);
    renderRows();
  };
  if(courseMode && typeof window.renderCart==="function") window.renderCart();
})();