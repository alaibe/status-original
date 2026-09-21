//! The address book, read through the Contacts framework on macOS. Other
//! systems report it as unavailable.

use serde::Serialize;

#[derive(Serialize)]
pub struct DeviceContact {
    pub id: String,
    pub given: Option<String>,
    pub family: Option<String>,
    pub phone: Option<String>,
}

#[cfg(target_os = "macos")]
mod platform {
    use std::cell::RefCell;
    use std::ptr::NonNull;
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_contacts::{
        CNAuthorizationStatus, CNContact, CNContactFamilyNameKey, CNContactFetchRequest,
        CNContactGivenNameKey, CNContactIdentifierKey, CNContactPhoneNumbersKey, CNContactStore,
        CNEntityType, CNKeyDescriptor,
    };
    use objc2_foundation::{NSArray, NSError, NSString};

    use super::DeviceContact;

    fn label(status: CNAuthorizationStatus) -> &'static str {
        match status {
            CNAuthorizationStatus::NotDetermined => "unknown",
            CNAuthorizationStatus::Authorized => "all",
            CNAuthorizationStatus::Limited => "limited",
            _ => "none",
        }
    }

    pub fn access() -> &'static str {
        label(unsafe { CNContactStore::authorizationStatusForEntityType(CNEntityType::Contacts) })
    }

    pub fn request() -> Result<&'static str, String> {
        let (tx, rx) = mpsc::channel();
        let handler = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe {
            CNContactStore::new()
                .requestAccessForEntityType_completionHandler(CNEntityType::Contacts, &handler);
        }
        rx.recv().map_err(|e| e.to_string())?;
        Ok(access())
    }

    fn optional(value: Retained<NSString>) -> Option<String> {
        let text = value.to_string();
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    }

    pub fn read() -> Result<Vec<DeviceContact>, String> {
        let keys: [&ProtocolObject<dyn CNKeyDescriptor>; 4] = unsafe {
            [
                ProtocolObject::from_ref(CNContactIdentifierKey),
                ProtocolObject::from_ref(CNContactGivenNameKey),
                ProtocolObject::from_ref(CNContactFamilyNameKey),
                ProtocolObject::from_ref(CNContactPhoneNumbersKey),
            ]
        };
        let request = unsafe {
            CNContactFetchRequest::initWithKeysToFetch(
                CNContactFetchRequest::alloc(),
                &NSArray::from_slice(&keys),
            )
        };

        let found = RefCell::new(Vec::new());
        let each = RcBlock::new(|contact: NonNull<CNContact>, _stop: NonNull<Bool>| {
            let contact = unsafe { contact.as_ref() };
            let phone = unsafe { contact.phoneNumbers().firstObject() }
                .map(|entry| unsafe { entry.value().stringValue() }.to_string());
            found.borrow_mut().push(DeviceContact {
                id: unsafe { contact.identifier() }.to_string(),
                given: optional(unsafe { contact.givenName() }),
                family: optional(unsafe { contact.familyName() }),
                phone,
            });
        });

        let mut error = None;
        let ok = unsafe {
            CNContactStore::new().enumerateContactsWithFetchRequest_error_usingBlock(
                &request,
                Some(&mut error),
                &each,
            )
        };
        drop(each);
        if !ok {
            return Err(error
                .map(|e| e.localizedDescription().to_string())
                .unwrap_or_else(|| "Could not read the address book".to_string()));
        }
        Ok(found.into_inner())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::DeviceContact;

    pub fn access() -> &'static str {
        "unavailable"
    }

    pub fn request() -> Result<&'static str, String> {
        Ok("unavailable")
    }

    pub fn read() -> Result<Vec<DeviceContact>, String> {
        Ok(Vec::new())
    }
}

/// `unknown` until asked, then `all`, `limited`, `none`, or `unavailable` here.
#[tauri::command]
pub fn contacts_access() -> &'static str {
    platform::access()
}

/// Shows the system prompt the first time; the answer is remembered by the OS.
#[tauri::command]
pub async fn contacts_request() -> Result<&'static str, String> {
    tauri::async_runtime::spawn_blocking(platform::request)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn contacts_read() -> Result<Vec<DeviceContact>, String> {
    tauri::async_runtime::spawn_blocking(platform::read)
        .await
        .map_err(|e| e.to_string())?
}
