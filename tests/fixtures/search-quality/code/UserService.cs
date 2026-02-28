using System;
using System.Threading.Tasks;

namespace Example.Services
{
    /// <summary>Interface for user data access operations.</summary>
    public interface IUserRepository
    {
        Task<User> FindByIdAsync(int id);
        Task<User> FindByEmailAsync(string email);
        Task<int> CreateAsync(User user);
        Task UpdateAsync(User user);
        Task DeleteAsync(int id);
    }

    /// <summary>User domain model.</summary>
    public class User
    {
        public int Id { get; set; }
        public string Email { get; set; } = string.Empty;
        public string PasswordHash { get; set; } = string.Empty;
        public string Role { get; set; } = "user";
        public bool IsActive { get; set; } = true;
    }

    public class UserNotFoundException : Exception
    {
        public UserNotFoundException(int id)
            : base($"User with id {id} not found") { }
    }

    /// <summary>
    /// Business logic layer for user management.
    /// Wraps IUserRepository and adds validation plus authorization.
    /// </summary>
    public class UserService
    {
        private readonly IUserRepository _repository;
        private readonly IPasswordHasher _hasher;

        public UserService(IUserRepository repository, IPasswordHasher hasher)
        {
            _repository = repository;
            _hasher = hasher;
        }

        public async Task<User> GetUserAsync(int id)
        {
            var user = await _repository.FindByIdAsync(id);
            if (user == null) throw new UserNotFoundException(id);
            return user;
        }

        public async Task<User> CreateUserAsync(string email, string password)
        {
            var existing = await _repository.FindByEmailAsync(email);
            if (existing != null)
                throw new InvalidOperationException($"Email {email} already registered");

            var user = new User
            {
                Email = email,
                PasswordHash = _hasher.Hash(password),
            };
            user.Id = await _repository.CreateAsync(user);
            return user;
        }

        public async Task ChangePasswordAsync(int userId, string oldPassword, string newPassword)
        {
            var user = await GetUserAsync(userId);
            if (!_hasher.Verify(oldPassword, user.PasswordHash))
                throw new UnauthorizedAccessException("Invalid current password");
            user.PasswordHash = _hasher.Hash(newPassword);
            await _repository.UpdateAsync(user);
        }

        public async Task DeactivateAsync(int userId)
        {
            var user = await GetUserAsync(userId);
            user.IsActive = false;
            await _repository.UpdateAsync(user);
        }

        private static bool IsValidEmail(string email) =>
            email.Contains('@') && email.Contains('.');
    }

    public interface IPasswordHasher
    {
        string Hash(string password);
        bool Verify(string password, string hash);
    }
}
