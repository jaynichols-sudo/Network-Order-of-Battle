import SwiftUI
import Contacts
import ContactsUI

/// The system "New Contact" card, filled in. You check it and tap Done; nothing is saved without you.
struct NewContactView: UIViewControllerRepresentable {
    let name: String
    var company = ""
    var title = ""
    var email = ""
    var phone = ""
    var url = ""
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(dismiss: { dismiss() }) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let c = CNMutableContact()
        let parts = name.split(separator: " ")
        c.givenName = parts.first.map(String.init) ?? name
        c.familyName = parts.dropFirst().joined(separator: " ")
        c.organizationName = company
        c.jobTitle = title
        if !email.isEmpty { c.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: email as NSString)] }
        if !phone.isEmpty { c.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))] }
        if !url.isEmpty { c.urlAddresses = [CNLabeledValue(label: "LinkedIn", value: url as NSString)] }
        let vc = CNContactViewController(forNewContact: c)
        vc.contactStore = CNContactStore()
        vc.delegate = context.coordinator
        return UINavigationController(rootViewController: vc)
    }

    func updateUIViewController(_ vc: UINavigationController, context: Context) {}

    final class Coordinator: NSObject, CNContactViewControllerDelegate {
        let dismiss: () -> Void
        init(dismiss: @escaping () -> Void) { self.dismiss = dismiss }
        func contactViewController(_ viewController: CNContactViewController, didCompleteWith contact: CNContact?) { dismiss() }
    }
}

/// Birthdays coming up this week, from your Contacts.
struct BirthdaysCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let list = model.upcomingBirthdays(within: 7)
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label("Birthdays this week", systemImage: "gift.fill")
                    .font(Theme.geist(.headline))
                    .foregroundStyle(Theme.bad)
                ForEach(list.prefix(4), id: \.person.k) { item in
                    Button { model.open(.person(item.person.k)) } label: {
                        HStack(spacing: 10) {
                            Avatar(person: item.person, size: 30)
                            Text(item.person.fullName).font(Theme.geist(.subheadline, .semibold)).foregroundStyle(.primary)
                            Spacer()
                            Text(day(item.date)).font(Theme.mono(.footnote)).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func day(_ d: Date) -> String {
        if Calendar.current.isDateInToday(d) { return "Today" }
        if Calendar.current.isDateInTomorrow(d) { return "Tomorrow" }
        return d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }
}
