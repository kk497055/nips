/* ========================================
   NIPS Education Solutions - Main JavaScript
   ======================================== */

document.addEventListener("DOMContentLoaded", function () {
  // Initialize all components
  initNavbar();
  initMobileMenu();
  initAnimatedCounters();
  initScrollAnimations();
  initBackToTop();
  initFormHandling();
});

/* ========================================
   Navbar Scroll Effect
   ======================================== */
function initNavbar() {
  const navbar = document.getElementById("navbar");

  if (!navbar) return;

  const handleScroll = () => {
    if (window.scrollY > 50) {
      navbar.classList.add("scrolled");
    } else {
      navbar.classList.remove("scrolled");
    }
  };

  window.addEventListener("scroll", handleScroll);
  handleScroll(); // Check initial state
}

/* ========================================
   Mobile Menu
   ======================================== */
function initMobileMenu() {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const navMenu = document.getElementById("nav-menu");

  if (!menuBtn || !navMenu) return;

  menuBtn.addEventListener("click", function () {
    this.classList.toggle("active");
    navMenu.classList.toggle("active");
    document.body.style.overflow = navMenu.classList.contains("active")
      ? "hidden"
      : "";
  });

  // Close menu when clicking on a link
  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menuBtn.classList.remove("active");
      navMenu.classList.remove("active");
      document.body.style.overflow = "";
    });
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!navMenu.contains(e.target) && !menuBtn.contains(e.target)) {
      menuBtn.classList.remove("active");
      navMenu.classList.remove("active");
      document.body.style.overflow = "";
    }
  });
}

/* ========================================
   Animated Counters
   ======================================== */
function initAnimatedCounters() {
  const counters = document.querySelectorAll(".stat-number[data-count]");

  if (!counters.length) return;

  const animateCounter = (counter) => {
    const target = parseInt(counter.getAttribute("data-count"));
    const duration = 2000;
    const step = target / (duration / 16);
    let current = 0;

    const updateCounter = () => {
      current += step;
      if (current < target) {
        counter.textContent = Math.floor(current);
        requestAnimationFrame(updateCounter);
      } else {
        counter.textContent = target;
      }
    };

    updateCounter();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  counters.forEach((counter) => observer.observe(counter));
}

/* ========================================
   Scroll Animations
   ======================================== */
function initScrollAnimations() {
  const animatedElements = document.querySelectorAll(
    ".course-card, .feature-card, .testimonial-card, .section-header, .hero-content, .hero-visual"
  );

  if (!animatedElements.length) return;

  // Add initial state
  animatedElements.forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(30px)";
    el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
          }, index * 100);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
  );

  animatedElements.forEach((el) => observer.observe(el));
}

/* ========================================
   Back to Top Button
   ======================================== */
function initBackToTop() {
  const backToTop = document.getElementById("back-to-top");

  if (!backToTop) return;

  window.addEventListener("scroll", () => {
    if (window.scrollY > 500) {
      backToTop.classList.add("visible");
    } else {
      backToTop.classList.remove("visible");
    }
  });

  backToTop.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });
}

/* ========================================
   Form Handling
   ======================================== */
function initFormHandling() {
  const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    form.addEventListener("submit", async function (e) {
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;

      // Show loading state
      submitBtn.disabled = true;
      submitBtn.innerHTML = "<span>Sending...</span>";

      // If it's a Formspree form, let it submit normally
      // Otherwise handle with custom logic
      if (!form.action.includes("formspree.io")) {
        e.preventDefault();

        // Simulate form submission
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Show success message
        showNotification("Thank you! We will contact you soon.", "success");
        form.reset();
      }

      // Reset button after delay
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }, 2000);
    });
  });
}

/* ========================================
   Notification System
   ======================================== */
function showNotification(message, type = "success") {
  // Remove existing notifications
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">&times;</button>
    `;

  // Add styles
  notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${type === "success" ? "#10b981" : "#ef4444"};
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;

  document.body.appendChild(notification);

  // Auto remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// Add notification animations
const style = document.createElement("style");
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    .notification button {
        background: none;
        border: none;
        color: white;
        font-size: 1.5rem;
        cursor: pointer;
        opacity: 0.8;
    }
    .notification button:hover {
        opacity: 1;
    }
`;
document.head.appendChild(style);

/* ========================================
   Smooth Scroll for Anchor Links
   ======================================== */
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    const href = this.getAttribute("href");
    if (href === "#") return;

    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      const navHeight = document.querySelector(".navbar").offsetHeight;
      const targetPosition =
        target.getBoundingClientRect().top + window.scrollY - navHeight - 20;

      window.scrollTo({
        top: targetPosition,
        behavior: "smooth",
      });
    }
  });
});

/* ========================================
   Lazy Loading Images
   ======================================== */
if ("IntersectionObserver" in window) {
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute("data-src");
        }
        imageObserver.unobserve(img);
      }
    });
  });

  document.querySelectorAll("img[data-src]").forEach((img) => {
    imageObserver.observe(img);
  });
}

/* ========================================
   Course Filter (for courses page)
   ======================================== */
function filterCourses(category) {
  const cards = document.querySelectorAll(".course-card");
  const buttons = document.querySelectorAll(".filter-btn");

  buttons.forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.filter === category) {
      btn.classList.add("active");
    }
  });

  cards.forEach((card) => {
    if (category === "all" || card.dataset.category === category) {
      card.style.display = "block";
      card.style.animation = "fadeIn 0.5s ease";
    } else {
      card.style.display = "none";
    }
  });
}

/* ========================================
   FAQ Accordion (for resources page)
   ======================================== */
function initFaqAccordion() {
  const faqItems = document.querySelectorAll(".faq-item");

  faqItems.forEach((item) => {
    const question = item.querySelector(".faq-question");

    question.addEventListener("click", () => {
      const isActive = item.classList.contains("active");

      // Close all other items
      faqItems.forEach((other) => {
        other.classList.remove("active");
      });

      // Toggle current item
      if (!isActive) {
        item.classList.add("active");
      }
    });
  });
}

// Initialize FAQ if on resources page
if (document.querySelector(".faq-item")) {
  initFaqAccordion();
}

/* ========================================
   Form Validation
   ======================================== */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePhone(phone) {
  const re = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
  return re.test(phone);
}

// Add validation to enrollment form if exists
const enrollForm = document.getElementById("enrollment-form");
if (enrollForm) {
  enrollForm.addEventListener("submit", function (e) {
    e.preventDefault();

    const email = this.querySelector('input[name="email"]');
    const phone = this.querySelector('input[name="phone"]');
    let isValid = true;

    if (email && !validateEmail(email.value)) {
      showFieldError(email, "Please enter a valid email address");
      isValid = false;
    }

    if (phone && !validatePhone(phone.value)) {
      showFieldError(phone, "Please enter a valid phone number");
      isValid = false;
    }

    if (isValid) {
      // Submit the form
      this.submit();
    }
  });
}

function showFieldError(field, message) {
  // Remove existing error
  const existingError = field.parentElement.querySelector(".field-error");
  if (existingError) existingError.remove();

  const error = document.createElement("span");
  error.className = "field-error";
  error.textContent = message;
  error.style.cssText =
    "color: #ef4444; font-size: 0.85rem; margin-top: 4px; display: block;";

  field.parentElement.appendChild(error);
  field.style.borderColor = "#ef4444";

  field.addEventListener(
    "input",
    () => {
      error.remove();
      field.style.borderColor = "";
    },
    { once: true }
  );
}

console.log("NIPS Education Solutions - Website Initialized");
