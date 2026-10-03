// @edit:NAVBAR_LINKS — presentation only; future API authorization must be enforced on the server.
export const navigation = {
  public: [
    { label: 'Overview', href: '#overview' },
    { label: 'Modules', href: '#modules' },
    { label: 'Team', href: '#team' },
  ],
  // Planned items have no invented URLs. Enable only after their routes exist.
  member: [
    { label: 'My membership', planned: true },
    { label: 'My tickets', planned: true },
    { label: 'My orders', planned: true },
  ],
  staff: [
    { label: 'Members', planned: true },
    { label: 'Check-in', planned: true },
    { label: 'Finance', planned: true },
  ],
};
