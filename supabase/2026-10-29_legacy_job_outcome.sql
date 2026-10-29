begin;
update public.evolution_jobs
set title = 'Send a daily shortlist of junior developer jobs in India',
  description = E'Send a concise daily shortlist of legitimate junior software development jobs and internships suited to a 2026 B.Sc IT graduate with React, JavaScript, Python, Django, REST API and SQL skills.\n\nPrioritize Mumbai, Navi Mumbai, Thane, Pune and remote opportunities open to candidates in India. Include the company, role, location, salary or stipend when available, eligibility, posting date and direct application link. Rank by skill fit, exclude senior, expired or suspicious listings, and avoid repeating opportunities.',
  frequency = 'Daily'
where legacy_post_id = 'ff5947f4-ddfc-45a9-92ad-7f144549236e'
  and title = 'Find relevant work according to my roles';
commit;
