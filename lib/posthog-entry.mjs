// Bundle locally with a locked version. This entry never loads external feature scripts.
import posthog from 'posthog-js/no-external';
window.XettlPostHog = posthog;
