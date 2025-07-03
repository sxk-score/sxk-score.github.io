const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');
        
hamburger.addEventListener('click', () => {
    navMenu.classList.toggle('active');
});

document.querySelectorAll('.nav-menu a').forEach(item => {
    item.addEventListener('click', () => {
        navMenu.classList.remove('active');
    });
});