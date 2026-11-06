(function () {
  var header = document.querySelector(".site-header");
  var solidAlways = document.body.hasAttribute("data-solid-header");
  function onScroll() {
    if (!header) return;
    if (solidAlways || window.scrollY > window.innerHeight * 0.6) header.classList.add("is-solid");
    else header.classList.remove("is-solid");
    var p = document.querySelector(".campaign .parallax");
    if (p) {
      var r = p.parentElement.getBoundingClientRect();
      p.style.transform = "translate3d(0," + Math.round(-r.top * 0.25) + "px,0)";
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  var toggle = document.querySelector(".menu-toggle");
  var menu = document.querySelector(".mobile-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  var cookie = document.querySelector(".cookie-banner button");
  if (cookie) cookie.addEventListener("click", function () { cookie.closest(".cookie-banner").remove(); });
})();
